import TakeoffGame from "./games/takeoff/TakeoffGame";
import "./games/takeoff/takeoff.css";
import "./app.css";

export default function App() {
  return (
    <main className="app">
      <TakeoffGame maxSeconds={15} />
    </main>
  );
}
