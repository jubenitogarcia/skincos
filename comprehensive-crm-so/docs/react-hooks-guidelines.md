# React Hooks Guidelines - SKINCOS AI

## ⚠️ CRITICAL: Preventing "Rendered more hooks than during the previous render" Error

### 🚫 NEVER DO THIS (Common Mistakes)

#### ❌ Early Return Before Hooks
```javascript
// WRONG - Early return before hooks
function Component({ isConnected }) {
  if (!isConnected) {
    return <div>Not connected</div>  // ❌ EARLY RETURN
  }
  
  const [state, setState] = useState()  // ❌ Hook after conditional return
  useEffect(() => {}, [])               // ❌ These hooks won't run consistently
}
```

#### ❌ Hooks Inside Conditions
```javascript
// WRONG - Hooks inside conditions
function Component({ mode }) {
  if (mode === 'edit') {
    const [value, setValue] = useState('')  // ❌ Hook inside condition
  }
}
```

#### ❌ Hooks Inside Loops
```javascript
// WRONG - Hooks inside loops
function Component({ items }) {
  items.forEach(item => {
    useEffect(() => {})  // ❌ Hook inside loop
  })
}
```

### ✅ CORRECT PATTERNS

#### ✅ All Hooks First, Then Conditionals
```javascript
// CORRECT - All hooks at the top
function Component({ isConnected }) {
  // 1. ALWAYS call ALL hooks first
  const [state, setState] = useState()
  const [loading, setLoading] = useState(false)
  useEffect(() => {}, [])
  
  // 2. Store conditional UI in variables
  const notConnectedUI = (
    <div>Not connected</div>
  )
  
  // 3. Conditional returns AFTER all hooks
  if (!isConnected) {
    return notConnectedUI
  }
  
  // 4. Main UI
  return <div>Connected: {state}</div>
}
```

#### ✅ Conditional Logic Inside Hooks
```javascript
// CORRECT - Move conditions inside hooks
function Component({ shouldFetch }) {
  // Always call the hook
  useEffect(() => {
    // Condition INSIDE the hook
    if (!shouldFetch) return
    
    fetchData()
  }, [shouldFetch])
}
```

#### ✅ Conditional Values, Not Conditional Hooks
```javascript
// CORRECT - Use conditional values
function Component({ mode }) {
  // Always call useState
  const [value, setValue] = useState(
    mode === 'edit' ? 'editing' : 'viewing'  // Conditional value
  )
}
```

### 📋 React Hooks Rules Summary

1. **Only Call Hooks at the Top Level**
   - Never inside conditions, loops, or nested functions
   - Always in the same order every render

2. **Only Call Hooks from React Functions**
   - React component functions
   - Custom hooks (functions starting with "use")

3. **All Hooks Before Any Returns**
   - Declare ALL hooks first
   - Store conditional UI in variables
   - Return conditionally AFTER all hooks

### 🛠️ Debugging Hook Errors

If you see "Rendered more hooks than during the previous render":

1. **Search for early returns**
   ```bash
   grep -n "return" Component.tsx | head -20
   ```

2. **Check for conditional hooks**
   ```bash
   grep -n "if.*use" Component.tsx
   ```

3. **Verify hook order**
   - Count hooks in each conditional path
   - Ensure same number and order in all paths

### 🏗️ Component Structure Template

```javascript
function Component(props) {
  // 1. All hooks declarations
  const [state1, setState1] = useState()
  const [state2, setState2] = useState()
  const context = useContext(MyContext)
  const data = useCustomHook()
  
  useEffect(() => {
    // Effect logic
  }, [])
  
  // 2. Computed values and handlers
  const computedValue = useMemo(() => {}, [])
  const handleClick = useCallback(() => {}, [])
  
  // 3. Conditional UI stored in variables
  const loadingUI = <Loading />
  const errorUI = <Error />
  
  // 4. Conditional returns (AFTER all hooks)
  if (loading) return loadingUI
  if (error) return errorUI
  
  // 5. Main return
  return <MainUI />
}
```

### 🎯 Key Takeaways

- **ALWAYS** call hooks in the same order
- **NEVER** put early returns before hooks
- **MOVE** conditions inside hooks or after them
- **STORE** conditional UI in variables
- **TEST** all conditional paths

## Applied Fixes in SKINCOS AI

1. **WhatsAppBusinessHub.tsx**: Moved `!whatsapp.connected` check to end, stored UI in `notConnectedUI` variable
2. **AuthContext.tsx**: Called `useReplitAuth()` unconditionally, conditional logic moved after hook
3. **All Components**: Verified no early returns before hooks

This ensures React can properly track hook state across renders!