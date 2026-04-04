import type { Metadata } from 'next';
import Link from 'next/link';
import { getModules, type Module } from '@/src/lib/shared/cms';
import { NavbarServer } from '@/src/components/layout/NavbarServer';

const FALLBACK_MODULES: Module[] = [
  { id:'1',  name:'Real Estate Financial Modeling', slug:'real-estate',        description:'Multi-asset development models covering residential, hospitality, retail, commercial, industrial, and more.', icon:'🏗️', status:'live',        display_order:1,  launch_date:null },
  { id:'2',  name:'Business Valuation',             slug:'business-valuation', description:'DCF analysis, comparable companies, precedent transactions, sum of parts, and LBO quick check.',            icon:'💼', status:'coming_soon', display_order:2,  launch_date:null },
  { id:'3',  name:'FP&A Modeling',                  slug:'fpa-modeling',       description:'Annual budgets, rolling forecasts, budget vs actual variance analysis, and department P&L.',               icon:'📊', status:'coming_soon', display_order:3,  launch_date:null },
  { id:'4',  name:'Equity Research',                slug:'equity-research',    description:'Financial model templates, initiation of coverage reports, earnings models, and sector-specific models.',  icon:'📈', status:'coming_soon', display_order:4,  launch_date:null },
  { id:'5',  name:'Project Finance',                slug:'project-finance',    description:'Infrastructure PPP, power and energy models, concession modeling, DSCR analysis, and debt sculpting.',   icon:'🏦', status:'coming_soon', display_order:5,  launch_date:null },
  { id:'6',  name:'LBO Modeling',                   slug:'lbo-modeling',       description:'Full leveraged buyout models — sources and uses, debt schedule, management equity, returns waterfall.',   icon:'🔄', status:'coming_soon', display_order:6,  launch_date:null },
  { id:'7',  name:'Corporate Finance',              slug:'corporate-finance',  description:'M&A models, merger consequences, accretion/dilution analysis, synergy modeling, fairness opinions.',      icon:'🌍', status:'coming_soon', display_order:7,  launch_date:null },
  { id:'8',  name:'Energy & Utilities',             slug:'energy-utilities',   description:'Solar, wind, oil and gas, utility rate models, carbon credits, and power purchase agreements.',           icon:'⚡', status:'coming_soon', display_order:8,  launch_date:null },
  { id:'9',  name:'Startup & Venture',              slug:'startup-venture',    description:'SaaS unit economics, runway and burn analysis, cap table modeling, cohort analysis, VC returns.',         icon:'🚀', status:'coming_soon', display_order:9,  launch_date:null },
  { id:'10', name:'Banking & Credit',               slug:'banking-credit',     description:'Credit analysis, loan modeling, NPL workout, Basel compliance, portfolio stress testing.',                icon:'🏛️', status:'coming_soon', display_order:10, launch_date:null },
];

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'About — Financial Modeler Pro',
  description: 'Learn about Financial Modeler Pro — the professional financial modeling platform built for developers, analysts, and investors across all disciplines.',
};

export default async function AboutPage() {
  const modules = await getModules();
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh' }}>

      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* Hero */}
      <section style={{ padding: '80px 40px 64px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#4A90D9', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>About</div>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 800, color: '#fff', marginBottom: 20, lineHeight: 1.15 }}>
            Built for Financial Modeling Professionals
          </h1>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7 }}>
            Financial Modeler Pro was built to solve a real problem: professional financial modeling shouldn&apos;t require 5 years of Excel wizardry. It should be structured, auditable, and presentation-ready from day one.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section style={{ padding: '80px 40px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 48 }}>
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: '#fff', marginBottom: 16 }}>Our Mission</h2>
            <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.75, marginBottom: 16 }}>
              To make professional-grade financial modeling accessible to every developer, analyst, and investor — regardless of their spreadsheet skill level.
            </p>
            <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.75 }}>
              We believe that the quality of a financial model shouldn&apos;t be limited by the tools available. Financial Modeler Pro provides the structure, the logic, and the output formats that deal-makers actually need.
            </p>
          </div>
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: '#fff', marginBottom: 16 }}>Who We Serve</h2>
            {[
              { icon: '🏗️', role: 'Real Estate Developers',  desc: 'Underwrite new projects with full development cost, financing, and returns modeling.' },
              { icon: '📊', role: 'Financial Analysts',       desc: 'Build audit-ready models with traceable assumptions and structured outputs.' },
              { icon: '💼', role: 'Investment Managers',      desc: 'Analyze deals faster with pre-built frameworks for IRR, NPV, and equity structuring.' },
              { icon: '🏢', role: 'Advisory Firms',           desc: 'White-label the platform for your clients with custom branding and workflows.' },
            ].map(({ icon, role, desc }) => (
              <div key={role} style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <span style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{role}</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Platform Modules */}
      <section style={{ padding: '0 40px 80px', background: 'rgba(0,0,0,0.15)', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', paddingTop: 80 }}>
          <h2 style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 8, textAlign: 'center' }}>The 6-Module Platform</h2>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginBottom: 48 }}>Each module builds on the last. Your assumptions cascade automatically.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
            {[
              { n: '01', icon: '🏗️', name: 'Project Setup & Financing', status: 'Live',        desc: 'Timeline, land & area, development costs, debt/equity structure, and interest schedules.' },
              { n: '02', icon: '💰', name: 'Revenue Analysis',           status: 'Coming Soon', desc: 'Unit-level sales, rental pricing, phased delivery, and revenue recognition.' },
              { n: '03', icon: '📉', name: 'Operating Expenses',          status: 'Coming Soon', desc: 'Property management, maintenance, staff costs, and overheads.' },
              { n: '04', icon: '📈', name: 'Returns & Valuation',         status: 'Coming Soon', desc: 'IRR, NPV, equity multiple, cap rate, and multi-scenario comparison.' },
              { n: '05', icon: '📑', name: 'Financial Statements',        status: 'Coming Soon', desc: 'Auto-generated P&L, Balance Sheet, and Cash Flow Statement.' },
              { n: '06', icon: '📊', name: 'Reports & Export',            status: 'Coming Soon', desc: 'Investor PDF reports and formula-linked Excel workbooks.' },
            ].map(({ n, icon, name, status, desc }) => (
              <div key={n} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '20px', borderLeft: status === 'Live' ? '3px solid #1B4F8A' : '3px solid rgba(255,255,255,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 20 }}>{icon}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.05em' }}>MODULE {n}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: status === 'Live' ? 'rgba(22,101,52,0.3)' : 'rgba(120,53,15,0.3)', color: status === 'Live' ? '#86EFAC' : '#FCD34D', border: status === 'Live' ? '1px solid rgba(134,239,172,0.25)' : '1px solid rgba(252,211,77,0.2)' }}>
                    {status === 'Live' ? '✓ LIVE' : 'SOON'}
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 7 }}>{name}</div>
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team / Founder */}
      <section style={{ padding: '80px 40px', maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ fontSize: 26, fontWeight: 800, color: '#fff', marginBottom: 16 }}>Built by a Practitioner</h2>
        <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.75, marginBottom: 32 }}>
          Financial Modeler Pro was founded by Ahmad Din — a corporate finance and transaction advisory professional with 12+ years of experience structuring deals across KSA, Pakistan, and international markets. Every feature is designed around how deals actually get done.
        </p>
        <Link href="/about/ahmad-din" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'rgba(27,79,138,0.25)', border: '1px solid rgba(27,79,138,0.5)',
          color: '#fff', fontSize: 13, fontWeight: 700, padding: '10px 24px', borderRadius: 7, textDecoration: 'none',
        }}>
          Read Ahmad&apos;s Profile →
        </Link>
      </section>

      {/* Our Platforms */}
      <section style={{ padding: '80px 40px', background: '#0A2248' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#4A90D9', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Our Platforms</div>
            <h2 style={{ fontSize: 'clamp(22px,3vw,32px)', fontWeight: 800, color: '#fff', marginBottom: 12 }}>10+ Professional Modeling Platforms</h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)' }}>Live now and launching soon — one destination for every financial modeling discipline.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
            {(modules.length > 0 ? modules : FALLBACK_MODULES).map((mod) => (
              <div key={mod.id} style={{ background: mod.status === 'live' ? 'rgba(27,79,138,0.2)' : 'rgba(255,255,255,0.03)', border: mod.status === 'live' ? '1px solid rgba(27,79,138,0.4)' : '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '20px', borderLeft: mod.status === 'live' ? '3px solid #1B4F8A' : '3px solid rgba(255,255,255,0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 24 }}>{mod.icon}</span>
                  {mod.status === 'live'
                    ? <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(22,101,52,0.3)', color: '#86EFAC', border: '1px solid rgba(134,239,172,0.25)' }}>✓ LIVE</span>
                    : <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(120,53,15,0.3)', color: '#FCD34D', border: '1px solid rgba(252,211,77,0.2)' }}>COMING SOON</span>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: mod.status === 'live' ? '#fff' : 'rgba(255,255,255,0.55)', marginBottom: 6 }}>{mod.name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 }}>{mod.description.substring(0, 80)}{mod.description.length > 80 ? '…' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: '64px 40px', textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <h2 style={{ fontSize: 26, fontWeight: 800, color: '#fff', marginBottom: 14 }}>Start Modeling for Free</h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', marginBottom: 28 }}>No credit card required. Full Module 1 access on the free plan.</p>
        <Link href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1B4F8A', color: '#fff', fontWeight: 700, fontSize: 14, padding: '12px 32px', borderRadius: 8, textDecoration: 'none' }}>
          Launch Platform Free →
        </Link>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '24px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>© {new Date().getFullYear()} Financial Modeler Pro</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>Structured Modeling. Real-World Finance.</span>
      </footer>
    </div>
  );
}
