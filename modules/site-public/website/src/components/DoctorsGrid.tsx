import Image from "next/image";
import { doctors } from "@/data/doctors";
import DoctorAgendarPill from "@/components/DoctorAgendarPill";

export default function DoctorsGrid() {
  return (
    <div className="grid">
      {doctors.map((d) => (
        <div className="card" key={d.slug}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, overflow: "hidden", background: "white" }}>
              {d.image ? <Image src={d.image} alt={d.name} width={56} height={56} /> : null}
            </div>
            <div>
              <h3 style={{ margin: 0 }}>{d.name}</h3>
              <p style={{ margin: 0 }}>{d.days}</p>
            </div>
          </div>
          <div className="pillRow">
            <DoctorAgendarPill doctorName={d.name} />
          </div>
        </div>
      ))}
    </div>
  );
}
