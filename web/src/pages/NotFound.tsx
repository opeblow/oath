import { Link } from "react-router-dom";
import { Seal } from "../components/Seal";

export default function NotFound() {
  return (
    <div className="wrap section" style={{ display: "grid", justifyItems: "center", textAlign: "center", gap: 18 }}>
      <Seal size={110} mark="404" />
      <h1 style={{ fontSize: 44 }}>No such page.</h1>
      <p className="lede" style={{ maxWidth: 520 }}>Nothing was sworn at this address. The coin you want may be in the registry.</p>
      <div style={{ display: "flex", gap: 12 }}>
        <Link to="/coins" className="btn">Open the registry</Link>
        <Link to="/" className="btn btn-ghost">Home</Link>
      </div>
    </div>
  );
}
