# Orb runtime operations

Execute a partir da raiz do repositório ou da release nativa:

```bash
npm run orb:service:status
npm run orb:service:logs -- 200
npm run orb:service:validate
```

Reinício controlado:

```bash
npm run orb:service:restart
npm run orb:service:validate
```

Backup manual usa a mesma unidade acionada pela tarefa agendada do Windows:

```bash
sudo systemctl start orb-backup.service
sudo systemctl status orb-backup.service --no-pager
```

O backup só é publicável após restore PostgreSQL, checksum do banco e checksum
do storage. Consulte `../../docs/runbooks/lifecycle-runtime-cutover.md` para
promoção, rollback e restauração. Não mova estado para o checkout nem execute
processos a partir de `/mnt/c`.
