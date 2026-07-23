import { defaultUnitsSeedRows, harmoniaMigrationStatements } from '../server/harmonia/store/migrate.js'

export async function apply(client) {
    for (const statement of harmoniaMigrationStatements()) await client.query(statement)
    for (const unit of defaultUnitsSeedRows()) {
        await client.query(
            `insert into harmonia.units(slug,name,timezone,working_hours) values($1,$2,$3,$4::jsonb)
             on conflict(slug) do update set name=excluded.name,timezone=excluded.timezone,working_hours=excluded.working_hours,updated_at=now()`,
            [unit.slug, unit.name, unit.timezone, JSON.stringify(unit.working_hours)],
        )
    }
}
