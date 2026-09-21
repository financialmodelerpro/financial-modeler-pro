import Link from 'next/link';
import styles from './EquityResearchPlatform.module.css';

const plannedModules = [
  { name: 'House Research', description: 'Company, quarterly and sector research by FMP / PaceMakers.' },
  { name: 'Companies', description: 'A Saudi listed-company universe, with GCC coverage to follow.' },
  { name: 'Financials', description: 'Reviewed annual and quarterly financial history with source references.' },
  { name: 'Forecast', description: 'Analyst assumptions, financial statements and scenarios.' },
  { name: 'Valuation', description: 'Valuation analysis grounded in approved financial models.' },
  { name: 'Research Reports', description: 'Concise equity research reports with a consistent structure.' },
];

export default function EquityResearchPlatform() {
  return (
    <div className={styles.platform}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <span className={styles.brand}>Financial Modeler Pro</span>
          <Link href="/modeling/dashboard" prefetch={false} className={styles.hubLink}>
            Back to Modeling Hub
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.introduction}>
          <p className={styles.eyebrow}>FMP / PaceMakers House Research</p>
          <h1 className={styles.title}>Equity Research Financial Modeling</h1>
          <p className={styles.description}>
            A dedicated workspace for listed-company research within Financial Modeler Pro.
          </p>
        </div>

        <section aria-labelledby="erm-workspace-title">
          <div className={styles.sectionHeading}>
            <h2 id="erm-workspace-title">Workspace foundation</h2>
            <p>
              The House Research workspace is being prepared. The areas below are planned
              and are not yet available.
            </p>
          </div>
          <ul className={styles.moduleList}>
            {plannedModules.map((module) => (
              <li key={module.name} className={styles.module}>
                <span className={styles.status}>Planned</span>
                <h3>{module.name}</h3>
                <p>{module.description}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
