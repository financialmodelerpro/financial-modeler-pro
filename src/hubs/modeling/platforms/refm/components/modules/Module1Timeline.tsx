'use client';

import React, { useState } from 'react';
import type { ModelType, ProjectType } from '@/src/core/types/project.types';
import { COUNTRY_DATA } from '../RealEstatePlatform';

interface Module1TimelineProps {
  projectName: string; setProjectName: (v: string) => void;
  projectType: ProjectType; setProjectType: (v: ProjectType) => void;
  country: string; setCountry: (v: string) => void;
  currency: string; setCurrency: (v: string) => void;
  modelType: ModelType; setModelType: (v: ModelType) => void;
  projectStart: string; setProjectStart: (v: string) => void;
  constructionPeriods: number; setConstructionPeriods: (v: number) => void;
  operationsPeriods: number; setOperationsPeriods: (v: number) => void;
  overlapPeriods: number; setOverlapPeriods: (v: number) => void;
  getProjectEndDate: () => string;
  readOnly: boolean;
  showAiButtons?: boolean;
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-body)',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'Inter, sans-serif',
  background: 'var(--color-warning-bg)',
  color: 'var(--color-warning-text)',
  fontWeight: 'var(--fw-semibold)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--font-meta)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-body)',
  marginBottom: '5px',
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

export default function Module1Timeline({
  projectName, setProjectName,
  projectType, setProjectType,
  country, setCountry,
  currency, setCurrency,
  modelType, setModelType,
  projectStart, setProjectStart,
  constructionPeriods, setConstructionPeriods,
  operationsPeriods, setOperationsPeriods,
  overlapPeriods, setOverlapPeriods,
  getProjectEndDate,
  readOnly,
  showAiButtons = false,
}: Module1TimelineProps) {
  const [countrySearch, setCountrySearch] = useState('');
  const [countryOpen, setCountryOpen] = useState(false);

  const filteredCountries = COUNTRY_DATA.filter(c =>
    !countrySearch || c.name.toLowerCase().includes(countrySearch.toLowerCase())
  );

  const selectedCountry = COUNTRY_DATA.find(c => c.name === country);
  const periodLabel = modelType === 'monthly' ? 'months' : 'years';
  const effectivePeriods = constructionPeriods + operationsPeriods - overlapPeriods;
  const endDate = getProjectEndDate();

  const rowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 'var(--sp-2)',
    marginBottom: 'var(--sp-2)',
  };

  return (
    <div>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h2 style={{ fontSize: 'var(--font-section)', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)', margin: '0 0 4px' }}>
          Project Timeline
        </h2>
        <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-meta)', margin: 0 }}>
          Define project identity, model structure, and timeline parameters
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>

        {/* Left column - Identity */}
        <div className="module-card" style={{ padding: 'var(--sp-3)' }}>
          <h3 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
            Project Identity
          </h3>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Project Name</label>
              {showAiButtons && (
                <button
                  onClick={() => {/* AI assist - coming soon */}}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 10, fontWeight: 700, padding: '3px 8px',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: '#fff', border: 'none', borderRadius: 4,
                    cursor: 'pointer', letterSpacing: '0.04em', flexShrink: 0,
                  }}
                  title="AI Assist (Pro)"
                >
                  ✨ AI Assist
                </button>
              )}
            </div>
            <input
              className="input-assumption"
              style={inputStyle}
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              disabled={readOnly}
              placeholder="Enter project name..."
            />
          </div>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Project Type</label>
            <select
              className="input-assumption"
              style={inputStyle}
              value={projectType}
              onChange={e => setProjectType(e.target.value as ProjectType)}
              disabled={readOnly}
            >
              <option value="mixed-use">Mixed-Use</option>
              <option value="residential">Residential</option>
              <option value="hospitality">Hospitality</option>
            </select>
          </div>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Country / Market</label>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => !readOnly && setCountryOpen(!countryOpen)}
                disabled={readOnly}
                style={{
                  ...inputStyle,
                  textAlign: 'left',
                  cursor: readOnly ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: '8px',
                  border: '1px solid var(--color-border)',
                }}
              >
                <span>{selectedCountry?.flag}</span>
                <span>{country}</span>
                <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--color-muted)' }}>▼</span>
              </button>

              {countryOpen && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: 'var(--shadow-modal)',
                  maxHeight: '280px', overflow: 'hidden',
                  display: 'flex', flexDirection: 'column',
                }}>
                  <div style={{ padding: '8px' }}>
                    <input
                      type="text"
                      placeholder="Search country..."
                      value={countrySearch}
                      onChange={e => setCountrySearch(e.target.value)}
                      style={{ ...inputStyle, marginBottom: 0, background: 'var(--color-surface)' }}
                      autoFocus
                    />
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {filteredCountries.map(c => (
                      <button
                        key={c.name}
                        onClick={() => {
                          setCountry(c.name);
                          setCurrency(c.currency);
                          setCountryOpen(false);
                          setCountrySearch('');
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          width: '100%', padding: '8px 12px', border: 'none',
                          background: c.name === country ? 'rgba(30,58,138,0.08)' : 'transparent',
                          cursor: 'pointer', fontSize: 'var(--font-body)',
                          textAlign: 'left', fontFamily: 'Inter, sans-serif',
                        }}
                      >
                        <span style={{ fontSize: '16px' }}>{c.flag}</span>
                        <span style={{ flex: 1, color: 'var(--color-body)' }}>{c.name}</span>
                        <span style={{ fontSize: '11px', color: 'var(--color-muted)', fontWeight: 600 }}>{c.currency}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Currency</label>
            <input
              className="input-assumption"
              style={inputStyle}
              type="text"
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              disabled={readOnly}
              placeholder="e.g. SAR"
            />
          </div>
        </div>

        {/* Right column - Model & Timeline */}
        <div className="module-card" style={{ padding: 'var(--sp-3)' }}>
          <h3 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
            Model Structure
          </h3>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Model Granularity</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {(['annual', 'monthly'] as ModelType[]).map(mt => (
                <button
                  key={mt}
                  onClick={() => !readOnly && setModelType(mt)}
                  disabled={readOnly}
                  style={{
                    flex: 1, padding: '8px', borderRadius: 'var(--radius-sm)',
                    border: modelType === mt ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                    background: modelType === mt ? 'rgba(30,58,138,0.08)' : 'var(--color-surface)',
                    cursor: readOnly ? 'not-allowed' : 'pointer',
                    fontWeight: modelType === mt ? 'var(--fw-bold)' : 'var(--fw-normal)',
                    color: modelType === mt ? 'var(--color-primary)' : 'var(--color-body)',
                    fontSize: 'var(--font-body)', textTransform: 'capitalize',
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {mt === 'annual' ? '📅 Annual' : '📆 Monthly'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Project Start Date</label>
            <input
              className="input-assumption"
              style={inputStyle}
              type="date"
              value={projectStart}
              onChange={e => setProjectStart(e.target.value)}
              disabled={readOnly}
            />
          </div>

          <div style={rowStyle}>
            <div>
              <label style={labelStyle}>Construction ({periodLabel})</label>
              <input
                className="input-assumption"
                style={inputStyle}
                type="number"
                min={1}
                max={modelType === 'monthly' ? 120 : 20}
                value={constructionPeriods}
                onChange={e => setConstructionPeriods(Number(e.target.value))}
                disabled={readOnly}
              />
            </div>
            <div>
              <label style={labelStyle}>Operations ({periodLabel})</label>
              <input
                className="input-assumption"
                style={inputStyle}
                type="number"
                min={1}
                max={modelType === 'monthly' ? 360 : 30}
                value={operationsPeriods}
                onChange={e => setOperationsPeriods(Number(e.target.value))}
                disabled={readOnly}
              />
            </div>
          </div>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Overlap ({periodLabel})</label>
            <input
              className="input-assumption"
              style={inputStyle}
              type="number"
              min={0}
              max={Math.min(constructionPeriods, operationsPeriods)}
              value={overlapPeriods}
              onChange={e => setOverlapPeriods(Number(e.target.value))}
              disabled={readOnly}
            />
            <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginTop: '4px' }}>
              Overlap of construction & operations phases
            </div>
          </div>

          {/* Timeline summary */}
          <div style={{
            background: 'rgba(30,58,138,0.05)',
            border: '1px solid rgba(30,58,138,0.15)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px',
            marginTop: 'var(--sp-1)',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              Timeline Summary
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { label: 'Start', value: projectStart },
                { label: 'End',   value: endDate },
                { label: 'Total Periods', value: `${effectivePeriods} ${periodLabel}` },
                { label: 'Type', value: modelType === 'annual' ? 'Annual model' : 'Monthly model' },
              ].map(item => (
                <div key={item.label}>
                  <div style={{ fontSize: '10px', color: 'var(--color-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{item.label}</div>
                  <div style={{ fontSize: 'var(--font-body)', fontWeight: 'var(--fw-semibold)', color: 'var(--color-heading)' }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline visual */}
      <div className="module-card" style={{ padding: 'var(--sp-3)', marginTop: 'var(--sp-2)' }}>
        <h3 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
          Project Timeline Visual
        </h3>
        <div style={{ display: 'flex', gap: '4px', height: '40px', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          <div style={{
            flex: constructionPeriods,
            background: 'rgba(30,58,138,0.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: '11px', fontWeight: 700,
          }}>
            Construction · {constructionPeriods} {periodLabel}
          </div>
          {overlapPeriods > 0 && (
            <div style={{
              flex: overlapPeriods,
              background: 'linear-gradient(90deg, rgba(30,58,138,0.75), rgba(22,101,52,0.75))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: '10px', fontWeight: 700,
            }}>
              Overlap
            </div>
          )}
          <div style={{
            flex: operationsPeriods,
            background: 'rgba(22,101,52,0.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: '11px', fontWeight: 700,
          }}>
            Operations · {operationsPeriods} {periodLabel}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
          <span style={{ fontSize: '11px', color: 'var(--color-muted)' }}>{projectStart}</span>
          <span style={{ fontSize: '11px', color: 'var(--color-muted)' }}>{endDate}</span>
        </div>
      </div>
    </div>
  );
}
