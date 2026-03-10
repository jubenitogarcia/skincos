import Link from "next/link";
import { units } from "@/data/units";

export default function UnitCards() {
  return (
    <div className="grid">
      {units.map((u) => (
        <div className="card" key={u.slug}>
          <h3>{u.name}</h3>
          <p>{u.addressLine || "Endereço a preencher"}</p>
          <div className="pillRow">
            <Link className="pill" href={`/unidades/${u.slug}`}>Ver unidade</Link>
            {u.instagram ? <a className="pill" href={u.instagram} target="_blank" rel="noopener noreferrer">Instagram</a> : null}
            {u.facebook ? <a className="pill" href={u.facebook} target="_blank" rel="noopener noreferrer">Facebook</a> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
