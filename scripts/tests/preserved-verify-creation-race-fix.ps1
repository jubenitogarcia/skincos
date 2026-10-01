$ErrorActionPreference='Stop'
$path='C:\CodexShared\Projetos\skincos\scripts\new-shared-worktree.ps1'
$source=[IO.File]::ReadAllText($path)
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
# Run the unchanged creation/guard logic with only filesystem/config/lifecycle
# helpers replaced in memory. Never invoke an executable Git or create fixtures.
$helpers=@($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -in 'Ensure-Directory','Ensure-SafeDirectory','Write-WorktreeLifecycleRecord'
},$true))
if($helpers.Count -ne 3){throw 'Unexpected creator helper topology.'}
foreach($helper in $helpers){
    $stub='function '+$helper.Name+' { '+$helper.Body.ParamBlock.Extent.Text+
        ' $global:raceFixEffects.Add("'+$helper.Name+'");'
    if($helper.Name -eq 'Write-WorktreeLifecycleRecord'){
        $stub+=' $global:raceFixLifecycleBase=$Base; return "mock-lifecycle";'
    }
    $source=$source.Replace($helper.Extent.Text,$stub+' }')
}
$creator=[scriptblock]::Create($source)
$global:raceFixShaA='1111111111111111111111111111111111111111'
$global:raceFixShaB='2222222222222222222222222222222222222222'
function Reset-Scenario([long]$Bytes){
    $global:raceFixBytes=$Bytes
    $global:raceFixRef=$global:raceFixShaA
    $global:raceFixCalls=[Collections.Generic.List[string]]::new()
    $global:raceFixEffects=[Collections.Generic.List[string]]::new()
    $global:raceFixEstimatedSha=$null
    $global:raceFixCreatedSha=$null
    $global:raceFixLifecycleBase=$null
}
function git {
    $call=$args -join ' '
    $global:raceFixCalls.Add($call)
    $global:LASTEXITCODE=0
    if($call -match 'worktree list --porcelain$'){return}
    if($call -match 'branch --list '){return}
    if($call -match 'rev-parse --verify --end-of-options (.+)\^\{commit\}$'){
        $ref=$Matches[1]
        if($ref -match '^[0-9a-f]{40}$'){$ref}else{$global:raceFixRef}
        return
    }
    if($call -match 'ls-tree -r -l ([0-9a-f]{40})$'){
        $global:raceFixEstimatedSha=$Matches[1]
        # Model another writer advancing the named ref after the single resolve.
        $global:raceFixRef=$global:raceFixShaB
        "100644 blob 3333333333333333333333333333333333333333 $global:raceFixBytes synthetic-file"
        return
    }
    if($call -match 'worktree add .+ -b .+ ([0-9a-f]{40})$'){
        $global:raceFixCreatedSha=$Matches[1]
        return
    }
    throw "Unexpected Git invocation; real Git is never called: $call"
}
$parameters=@{
    TaskSlug='revision-race-synthetic-only'
    Actor='admin'
    WorktreeRoot=$PSScriptRoot
    BaseRef='origin/main'
    IsolationReason='concurrent writer isolation'
}
foreach($flags in @(@{Fetch=$true;DryRun=$true},@{Fetch=$true;ConfirmLargeVolume=$true})){
    Reset-Scenario 2147483648
    try{
        & $creator @parameters @flags|Out-Null
        throw 'Fetch accepted.'
    }catch{if($_.Exception.Message -notmatch 'Implicit fetch is unsupported'){throw}}
    if($global:raceFixEffects.Count -ne 0 -or
       @($global:raceFixCalls|Where-Object {$_ -match ' fetch |ls-tree|rev-parse'}).Count){
        throw 'Fetch rejection occurred after side effects or revision planning.'
    }
}
'PASS: -Fetch rejects creation and dry run before fetch/planning/writes, even with volume confirmation.'

Reset-Scenario 2147483648
try{
    & $creator @parameters|Out-Null
    throw 'Large estimate accepted.'
}catch{if($_.Exception.Message -notmatch 'exceeds 1 GiB'){throw}}
if($global:raceFixEffects.Count -ne 0 -or $global:raceFixCreatedSha){throw 'Large guard was too late.'}
'PASS: large checkout still blocks before creation helpers.'

Reset-Scenario 2147483648
$plan=& $creator @parameters -DryRun|ConvertFrom-Json
if($plan.baseCommit -ne $global:raceFixShaA -or
   $plan.estimatedTrackedBytes -ne 2147483648 -or $plan.fetchPerformed -or
   $global:raceFixEffects.Count -ne 0){throw 'Dry-run revision or scope is incorrect.'}
'PASS: dry run reports the immutable local SHA, volume and separate fetch scope without writes.'

Reset-Scenario 256
$created=& $creator @parameters|ConvertFrom-Json
$resolutions=@($global:raceFixCalls|Where-Object {$_ -match 'rev-parse --verify --end-of-options origin/main'}).Count
if($resolutions -ne 1 -or $global:raceFixRef -ne $global:raceFixShaB -or
   $global:raceFixEstimatedSha -ne $global:raceFixShaA -or
   $global:raceFixCreatedSha -ne $global:raceFixShaA -or
   $global:raceFixLifecycleBase -ne $global:raceFixShaA -or
   $created.baseCommit -ne $global:raceFixShaA){throw 'Mutable ref changed the planned/created revision.'}
'PASS: named ref advances A to B between estimate and creation; estimate, checkout and lifecycle all remain pinned to A.'

Reset-Scenario 256
$global:raceFixRef=$global:raceFixShaB
$pinned=@{};foreach($key in $parameters.Keys){$pinned[$key]=$parameters[$key]}
$pinned.BaseRef=$plan.baseCommit
$pinnedPlan=& $creator @pinned -DryRun|ConvertFrom-Json
if($pinnedPlan.baseCommit -ne $global:raceFixShaA){throw 'Executing a dry-run SHA resolved the moved named ref.'}
'PASS: passing the reported baseCommit as BaseRef preserves the plan across invocations.'
if(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'admin')){throw 'A fixture directory was created.'}
