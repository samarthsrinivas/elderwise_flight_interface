import { useState } from "react";
import { AgeModelPanel } from "./modules/age/AgeModelPanel";
import { AiSettingsScreen } from "./modules/ai/AiSettingsScreen";
import { AssessmentScreen } from "./modules/assessment/AssessmentScreen";
import { HistoryScreen } from "./modules/history/HistoryScreen";
import { PRE_SCREENING_DISCLAIMER } from "./ui/disclaimer";
import "./App.css";

type TabId = "assessment" | "history" | "settings";

interface TabItem {
  readonly id: TabId;
  readonly label: string;
}

const TABS: readonly TabItem[] = [
  { id: "assessment", label: "Assessment" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>("assessment");

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand-block">
          <button
            type="button"
            className="brand"
            onClick={() => setActiveTab("assessment")}
            aria-label="Elderwise home"
          >
            Elderwise
          </button>
          <span className="brand-tagline">
            Voice, vitals and eye-movement check-in
          </span>
        </div>

        <nav className="app-nav" aria-label="Main Navigation">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                type="button"
                key={tab.id}
                className={`nav-tab ${isActive ? "active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="app-main">
        {activeTab === "assessment" && <AssessmentScreen />}
        {activeTab === "history" && <HistoryScreen />}
        {activeTab === "settings" && (
          <>
            <AiSettingsScreen />
            <section className="screen">
              <AgeModelPanel />
            </section>
          </>
        )}
      </main>

      <footer className="app-footer">
        <div className="app-footer__content">
          <p className="app-footer__disclaimer">{PRE_SCREENING_DISCLAIMER}</p>
          <span className="app-footer__version">v{__APP_VERSION__}</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
