# Rollback

O legado está preservado em `baseline/campaign-creative-generator-legacy` e continua sendo gerado pelo builder original. O v2 é inativo por padrão e seus exports ficam em `generated-workflows/`.

Para rollback local, remova somente os workflows v2 do projeto de teste e restaure os exports do baseline. Para rollback n8n, use a versão anterior/export antes do import; não altere credenciais ou banco de produção como parte de um rollback de workflow.

O migration SQL é aditivo. Antes de aplicar em qualquer banco, faça backup verificado e registre o SHA do migration e do export importado.
