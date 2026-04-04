import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import {
  renderToBuffer, Document, Page, View, Text, Link, StyleSheet, Image,
} from '@react-pdf/renderer';
import { getStudentProgress, getCertificatesByEmail } from '@/src/lib/training/sheets';
import { getServerClient } from '@/src/lib/shared/supabase';
import { COURSES } from '@/src/config/courses';

// ── Brand colours ─────────────────────────────────────────────────────────────
const C = {
  navy:    '#0D2E5A',
  navy2:   '#1B4F8A',
  green:   '#2EAA4A',
  gold:    '#C9A84C',
  goldBg:  '#FDF3DC',
  red:     '#DC2626',
  grey:    '#6B7280',
  lBlue:   '#EBF3FC',
  white:   '#FFFFFF',
  lGrey:   '#F9FAFB',
  border:  '#E5E7EB',
  text:    '#111827',
  muted:   '#6B7280',
};

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica', fontSize: 9, color: C.text,
    backgroundColor: C.white, paddingBottom: 36,
  },

  /* Header — bg overridden at runtime via settings.headerBgColor */
  header: {
    paddingHorizontal: 36, paddingTop: 14, paddingBottom: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  hLogoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  hLogo:    { width: 32, height: 32, marginRight: 8 },
  hBrand: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.white, marginBottom: 2 },
  hSub:   { fontSize: 7, color: 'rgba(255,255,255,0.55)', marginBottom: 1 },
  hTitle: {
    fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#90CAF9',
    letterSpacing: 1.2, marginTop: 6,
  },
  hRight: {
    alignItems: 'center',
  },
  hBadge: {
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 4,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  hBadgeText: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: 'rgba(255,255,255,0.8)' },

  /* Student info strip — bg overridden at runtime via settings.studentStripBg */
  studentStrip: {
    paddingHorizontal: 36, paddingVertical: 10,
    flexDirection: 'row',
  },
  infoCol: { flex: 1 },
  infoRow: { flexDirection: 'row', marginBottom: 3 },
  infoLabel: {
    fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.navy2, width: 100,
  },
  infoValue: { fontSize: 8.5, color: C.text },

  /* Status banner */
  bannerProgress: {
    backgroundColor: '#FFFBEB', paddingHorizontal: 36, paddingVertical: 6,
    borderTopWidth: 1, borderTopColor: '#FDE68A',
    borderBottomWidth: 1, borderBottomColor: '#FDE68A',
  },
  bannerComplete: {
    backgroundColor: '#F0FFF4', paddingHorizontal: 36, paddingVertical: 6,
    borderTopWidth: 1, borderTopColor: '#BBF7D0',
    borderBottomWidth: 1, borderBottomColor: '#BBF7D0',
  },
  bannerTitle:   { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.navy },
  bannerSub:     { fontSize: 8, color: C.muted, marginTop: 2 },

  /* Section heading */
  sectionHead: {
    paddingHorizontal: 36, paddingTop: 12, paddingBottom: 5,
    flexDirection: 'row', alignItems: 'center',
  },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.navy, marginRight: 8 },
  sectionLine:  { flex: 1, height: 1, backgroundColor: C.border },

  /* Table */
  tableWrap: { paddingHorizontal: 36 },
  tHead: {
    flexDirection: 'row',
    paddingVertical: 5, borderRadius: 4,
  },
  tRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border,
    paddingVertical: 4,
  },
  tRowAlt:   { backgroundColor: C.lGrey },
  tRowFinal: { backgroundColor: C.goldBg },

  colNum:     { width: 48, paddingHorizontal: 6 },
  colName:    { flex: 1, paddingHorizontal: 6 },
  colScore:   { width: 46, paddingHorizontal: 4, textAlign: 'center' as const },
  colStatus:  { width: 76, paddingHorizontal: 4 },
  colAttempt: { width: 52, paddingHorizontal: 6, textAlign: 'center' as const },

  thText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.white },
  tdText: { fontSize: 8.5, color: C.text },
  tdBold: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.text },
  tdMuted: { fontSize: 8, color: C.muted },

  /* Status badges */
  badgePassed: { backgroundColor: '#D1FAE5', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2 },
  badgeFailed: { backgroundColor: '#FEE2E2', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2 },
  badgeGrey:   { backgroundColor: '#F3F4F6', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2 },
  badgeGold:   { backgroundColor: '#FEF3C7', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2 },
  badgePassedTxt: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#065F46' },
  badgeFailedTxt: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#991B1B' },
  badgeGreyTxt:   { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.grey },
  badgeGoldTxt:   { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#92400E' },

  /* Summary boxes */
  summaryWrap: { flexDirection: 'row', paddingHorizontal: 36, paddingTop: 10, gap: 12 },
  summaryBox: { flex: 1, borderWidth: 1.5, borderRadius: 6, padding: 10 },
  summaryBoxNavy:  { borderColor: C.navy2 },
  summaryBoxGreen: { borderColor: C.green },
  summaryBoxGrey:  { borderColor: C.border },
  summaryTitle: {
    fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.navy,
    letterSpacing: 0.5, marginBottom: 10, textTransform: 'uppercase' as const,
  },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  sumLabel: { fontSize: 8, color: C.muted },
  sumVal:   { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.text },
  sumValGreen: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.green },
  sumValGold:  { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#B45309' },
  sumValRed:   { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.red },

  /* Footer — bg overridden at runtime via settings.headerBgColor */
  footer: {
    position: 'absolute' as const, bottom: 0, left: 0, right: 0,
    paddingHorizontal: 36, paddingVertical: 7,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  footerText: { fontSize: 7, color: 'rgba(255,255,255,0.55)' },
  footerLink: { fontSize: 7, color: '#90CAF9' },
});

// ── Transcript settings ───────────────────────────────────────────────────────

interface TranscriptSettings {
  headerBgColor: string; headerHeight: number;
  logoUrl: string; logoX: number; logoY: number; logoWidth: number; logoHeight: number; logoVisible: boolean;
  brandText: string; brandX: number; brandY: number; brandVisible: boolean;
  titleText: string; titleX: number; titleY: number; titleVisible: boolean;
  subtitleText: string; subtitleX: number; subtitleY: number; subtitleVisible: boolean;
  instructorText: string; instructorX: number; instructorY: number; instructorVisible: boolean;
  websiteText: string; websiteX: number; websiteY: number; websiteVisible: boolean;
  tableHeaderColor: string; studentStripBg: string;
  passedBg: string; passedColor: string; failedBg: string; failedColor: string;
  colNum: string; colSession: string; colScore: string; colStatus: string; colAttempts: string;
  bannerCompleteTitle: string; bannerCompleteSub: string;
  bannerProgressTitle: string; bannerProgressSub: string;
  footerBgColor: string;
  footerLeftText: string; footerLeftVisible: boolean;
  footerMidText: string;  footerMidVisible: boolean;
  footerRightText: string; footerRightVisible: boolean;
}

const DEFAULTS: TranscriptSettings = {
  headerBgColor: '#0D2E5A', headerHeight: 80,
  logoUrl: '', logoX: 520, logoY: 14, logoWidth: 40, logoHeight: 40, logoVisible: true,
  brandText: 'Financial Modeler Pro', brandX: 36, brandY: 18, brandVisible: true,
  titleText: 'OFFICIAL ACADEMIC TRANSCRIPT', titleX: 36, titleY: 56, titleVisible: true,
  subtitleText: 'FMP Training Hub', subtitleX: 455, subtitleY: 60, subtitleVisible: true,
  instructorText: 'Ahmad Din | Corporate Finance Expert', instructorX: 36, instructorY: 31, instructorVisible: true,
  websiteText: 'www.financialmodelerpro.com', websiteX: 36, websiteY: 41, websiteVisible: true,
  tableHeaderColor: '#1B4F8A', studentStripBg: '#EBF3FC',
  passedBg: '#D1FAE5', passedColor: '#065F46',
  failedBg: '#FEE2E2', failedColor: '#991B1B',
  colNum: '#', colSession: 'Session Name', colScore: 'Score', colStatus: 'Status', colAttempts: 'Attempts',
  bannerCompleteTitle: '✓ OFFICIAL TRANSCRIPT — Course Complete',
  bannerCompleteSub:   'All requirements fulfilled. Certificate issued as of [date].',
  bannerProgressTitle: '⏳ PROGRESS TRANSCRIPT — Course in Progress',
  bannerProgressSub:   'This transcript reflects current progress as of [date]. A final transcript will be issued upon course completion.',
  footerBgColor: '#0D2E5A',
  footerLeftText: 'Issue Date: [date]', footerLeftVisible: true,
  footerMidText:  'This transcript is an official record issued by Financial Modeler Pro. Verify at certifier.io', footerMidVisible: true,
  footerRightText: 'www.financialmodelerpro.com', footerRightVisible: true,
};

// CMS key map (mirrors editor K object)
const CMS: Record<keyof TranscriptSettings, string> = {
  headerBgColor:'transcript_header_bg', headerHeight:'transcript_header_h',
  logoUrl:'transcript_logo_url', logoX:'transcript_logo_x', logoY:'transcript_logo_y', logoWidth:'transcript_logo_w', logoHeight:'transcript_logo_h', logoVisible:'transcript_logo_vis',
  brandText:'transcript_brand_t', brandX:'transcript_brand_x', brandY:'transcript_brand_y', brandVisible:'transcript_brand_vis',
  titleText:'transcript_title_t', titleX:'transcript_title_x', titleY:'transcript_title_y', titleVisible:'transcript_title_vis',
  subtitleText:'transcript_sub_t', subtitleX:'transcript_sub_x', subtitleY:'transcript_sub_y', subtitleVisible:'transcript_sub_vis',
  instructorText:'transcript_instr_t', instructorX:'transcript_instr_x', instructorY:'transcript_instr_y', instructorVisible:'transcript_instr_vis',
  websiteText:'transcript_web_t', websiteX:'transcript_web_x', websiteY:'transcript_web_y', websiteVisible:'transcript_web_vis',
  tableHeaderColor:'transcript_tbl_hdr', studentStripBg:'transcript_strip_bg',
  passedBg:'transcript_pass_bg', passedColor:'transcript_pass_color',
  failedBg:'transcript_fail_bg', failedColor:'transcript_fail_color',
  colNum:'transcript_col_num', colSession:'transcript_col_sess', colScore:'transcript_col_score',
  colStatus:'transcript_col_status', colAttempts:'transcript_col_att',
  bannerCompleteTitle:'transcript_ban_ctitle', bannerCompleteSub:'transcript_ban_csub',
  bannerProgressTitle:'transcript_ban_ptitle', bannerProgressSub:'transcript_ban_psub',
  footerBgColor:'transcript_footer_bg',
  footerLeftText:'transcript_fl_t', footerLeftVisible:'transcript_fl_vis',
  footerMidText:'transcript_fm_t', footerMidVisible:'transcript_fm_vis',
  footerRightText:'transcript_fr_t', footerRightVisible:'transcript_fr_vis',
};

async function loadTranscriptSettings(): Promise<TranscriptSettings> {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('cms_content').select('key, value').eq('section', 'transcript');
    if (!data?.length) return DEFAULTS;
    const map: Record<string, string> = {};
    for (const row of data) map[row.key] = row.value;
    const result = { ...DEFAULTS };
    (Object.keys(DEFAULTS) as (keyof TranscriptSettings)[]).forEach(k => {
      const raw = map[CMS[k]];
      if (raw === undefined || raw === null) return;
      const def = DEFAULTS[k];
      if (typeof def === 'number') { const n = parseFloat(raw); if (Number.isFinite(n)) (result as Record<string,unknown>)[k] = n; }
      else if (typeof def === 'boolean') (result as Record<string,unknown>)[k] = raw === 'true';
      else (result as Record<string,unknown>)[k] = raw; // empty string is valid (user cleared a field)
    });
    return result;
  } catch {
    return DEFAULTS;
  }
}

// Fetch a URL and return it as a base64 data URI.
async function urlToBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString('base64');
    const ct  = res.headers.get('content-type') ?? 'image/png';
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

async function loadLogoBase64(url: string): Promise<string | null> {
  return urlToBase64(url);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return d; }
}

function todayStr() {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface ProgRow {
  sessionId: string;
  passed: boolean;
  score: number;
  attempts: number;
}

interface CertData {
  certificateId: string;
  issuedAt: string;
  certifierUrl: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface BadgeColors { passedBg: string; passedColor: string; failedBg: string; failedColor: string; }

function StatusBadge({ passed, attempts, isFinal, bc }: { passed: boolean; attempts: number; isFinal: boolean; bc: BadgeColors }) {
  if (passed) return <View style={[s.badgePassed, { backgroundColor: bc.passedBg }]}><Text style={[s.badgePassedTxt, { color: bc.passedColor }]}>PASSED</Text></View>;
  if (attempts > 0) return <View style={[s.badgeFailed, { backgroundColor: bc.failedBg }]}><Text style={[s.badgeFailedTxt, { color: bc.failedColor }]}>FAILED</Text></View>;
  if (isFinal) return <View style={s.badgeGold}><Text style={s.badgeGoldTxt}>LOCKED</Text></View>;
  return <View style={s.badgeGrey}><Text style={s.badgeGreyTxt}>NOT STARTED</Text></View>;
}

function CourseTable({ courseId, progressMap, settings }: { courseId: string; progressMap: Map<string, ProgRow>; settings: TranscriptSettings }) {
  const course = COURSES[courseId];
  if (!course) return null;
  const regularSessions  = course.sessions.filter(s => !s.isFinal);
  const finalSession     = course.sessions.find(s => s.isFinal);
  const allRegularPassed = regularSessions.every(s => progressMap.get(s.id)?.passed);
  const bc: BadgeColors  = { passedBg: settings.passedBg, passedColor: settings.passedColor, failedBg: settings.failedBg, failedColor: settings.failedColor };

  return (
    <View style={s.tableWrap}>
      {/* Table header */}
      <View style={[s.tHead, { backgroundColor: settings.tableHeaderColor }]}>
        <View style={s.colNum}><Text style={s.thText}>{settings.colNum}</Text></View>
        <View style={s.colName}><Text style={s.thText}>{settings.colSession}</Text></View>
        <View style={s.colScore}><Text style={s.thText}>{settings.colScore}</Text></View>
        <View style={s.colStatus}><Text style={s.thText}>{settings.colStatus}</Text></View>
        <View style={s.colAttempt}><Text style={s.thText}>{settings.colAttempts}</Text></View>
      </View>

      {/* Regular sessions */}
      {regularSessions.map((session, idx) => {
        const prog = progressMap.get(session.id);
        const isAlt = idx % 2 === 1;
        return (
          <View key={session.id} style={[s.tRow, isAlt ? s.tRowAlt : {}]}>
            <View style={s.colNum}><Text style={s.tdMuted}>{session.id}</Text></View>
            <View style={s.colName}><Text style={s.tdText}>{session.title}</Text></View>
            <View style={s.colScore}>
              <Text style={prog?.score ? s.tdBold : s.tdMuted}>
                {prog && prog.attempts > 0 ? `${prog.score}%` : '—'}
              </Text>
            </View>
            <View style={s.colStatus}>
              <StatusBadge passed={!!prog?.passed} attempts={prog?.attempts ?? 0} isFinal={false} bc={bc} />
            </View>
            <View style={s.colAttempt}>
              <Text style={s.tdText}>{prog?.attempts ?? 0} / {session.maxAttempts}</Text>
            </View>
          </View>
        );
      })}

      {/* Final exam row */}
      {finalSession && (
        <View style={[s.tRow, s.tRowFinal]}>
          <View style={s.colNum}><Text style={{ fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.gold }}>FINAL</Text></View>
          <View style={s.colName}>
            <Text style={s.tdBold}>{finalSession.title}</Text>
            <Text style={{ fontSize: 7, color: C.muted, marginTop: 2 }}>
              {finalSession.questionCount} questions · Pass mark {finalSession.passingScore}%
            </Text>
          </View>
          <View style={s.colScore}>
            {(() => {
              const fp = progressMap.get(finalSession.id);
              return <Text style={fp?.score ? s.tdBold : s.tdMuted}>
                {fp && fp.attempts > 0 ? `${fp.score}%` : '—'}
              </Text>;
            })()}
          </View>
          <View style={s.colStatus}>
            {(() => {
              const fp = progressMap.get(finalSession.id);
              if (!allRegularPassed && !fp?.attempts) {
                return <View style={s.badgeGold}><Text style={s.badgeGoldTxt}>LOCKED</Text></View>;
              }
              return <StatusBadge passed={!!fp?.passed} attempts={fp?.attempts ?? 0} isFinal bc={bc} />;
            })()}
          </View>
          <View style={s.colAttempt}>
            {(() => {
              const fp = progressMap.get(finalSession.id);
              return <Text style={s.tdText}>{fp?.attempts ?? 0} / {finalSession.maxAttempts}</Text>;
            })()}
          </View>
        </View>
      )}
    </View>
  );
}

function CourseSummaryBoxes({
  courseId, progressMap, cert, certBorderColor,
}: {
  courseId: string;
  progressMap: Map<string, ProgRow>;
  cert: CertData | null;
  certBorderColor: string;
}) {
  const course = COURSES[courseId];
  if (!course) return null;
  const regularSessions = course.sessions.filter(s => !s.isFinal);
  const finalSession    = course.sessions.find(s => s.isFinal);
  const passedCount     = regularSessions.filter(s => progressMap.get(s.id)?.passed).length;
  const scoresArr       = regularSessions.map(s => progressMap.get(s.id)).filter(p => p && p.attempts > 0).map(p => p!.score);
  const avgScore        = scoresArr.length ? Math.round(scoresArr.reduce((a, b) => a + b, 0) / scoresArr.length) : null;
  const finalProg       = finalSession ? progressMap.get(finalSession.id) : undefined;
  const allComplete     = passedCount === regularSessions.length && !!finalProg?.passed;

  return (
    <View style={s.summaryWrap}>
      {/* Academic summary */}
      <View style={[s.summaryBox, s.summaryBoxNavy]}>
        <Text style={s.summaryTitle}>Academic Summary — {course.shortTitle}</Text>
        <View style={s.sumRow}>
          <Text style={s.sumLabel}>Sessions Completed</Text>
          <Text style={s.sumVal}>{passedCount} of {regularSessions.length}</Text>
        </View>
        <View style={s.sumRow}>
          <Text style={s.sumLabel}>Sessions Passed</Text>
          <Text style={s.sumVal}>{passedCount} of {regularSessions.length}</Text>
        </View>
        <View style={s.sumRow}>
          <Text style={s.sumLabel}>Average Score</Text>
          <Text style={s.sumVal}>{avgScore !== null ? `${avgScore}%` : '—'}</Text>
        </View>
        <View style={s.sumRow}>
          <Text style={s.sumLabel}>Final Exam Score</Text>
          <Text style={s.sumVal}>{finalProg?.passed ? `${finalProg.score}%` : finalProg?.attempts ? `${finalProg.score}% (failed)` : '—'}</Text>
        </View>
        <View style={[s.sumRow, { marginBottom: 0, marginTop: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border }]}>
          <Text style={s.sumLabel}>Overall Result</Text>
          {allComplete
            ? <Text style={s.sumValGreen}>PASSED</Text>
            : <Text style={s.sumValGold}>IN PROGRESS</Text>}
        </View>
      </View>

      {/* Certificate status */}
      <View style={[s.summaryBox, { borderColor: certBorderColor }]}>
        <Text style={s.summaryTitle}>Certification Status</Text>
        <View style={s.sumRow}>
          <Text style={s.sumLabel}>Status</Text>
          {cert
            ? <Text style={s.sumValGreen}>CERTIFIED</Text>
            : allComplete
              ? <Text style={s.sumValGold}>PROCESSING</Text>
              : <Text style={[s.sumLabel, { fontFamily: 'Helvetica-Bold' }]}>NOT EARNED</Text>}
        </View>
        <View style={s.sumRow}>
          <Text style={s.sumLabel}>Certificate ID</Text>
          <Text style={s.sumVal}>{cert?.certificateId ?? '—'}</Text>
        </View>
        <View style={s.sumRow}>
          <Text style={s.sumLabel}>Issued</Text>
          <Text style={s.sumVal}>{cert ? fmtDate(cert.issuedAt) : '—'}</Text>
        </View>
        <View style={[s.sumRow, { marginBottom: 0 }]}>
          <Text style={s.sumLabel}>Verify at</Text>
          {cert?.certifierUrl
            ? <Link src={cert.certifierUrl} style={{ fontSize: 8, color: C.navy2 }}>certifier.io/verify →</Link>
            : <Text style={s.sumLabel}>—</Text>}
        </View>
      </View>
    </View>
  );
}

// ── Main PDF Document ─────────────────────────────────────────────────────────

interface TranscriptProps {
  studentName: string;
  registrationId: string;
  email: string;
  courseId: string;
  enrolledDate: string;
  progressMap: Map<string, ProgRow>;
  certs: Map<string, CertData>;
  isComplete: boolean;
  settings: TranscriptSettings;
  logoBase64: string | null;
}

function TranscriptDocument({
  studentName, registrationId, email, courseId, enrolledDate,
  progressMap, certs, isComplete, settings, logoBase64,
}: TranscriptProps) {
  const course = COURSES[courseId];
  const courseLabel = course?.title ?? courseId.toUpperCase();

  return (
    <Document title={`FMP Transcript — ${registrationId}`} author="Financial Modeler Pro">
      <Page size="A4" style={s.page}>

        {/* ── Header — absolute canvas ──────────────────────────────── */}
        <View style={{ backgroundColor: settings.headerBgColor, height: settings.headerHeight, position: 'relative' }}>
          {settings.logoVisible && settings.logoUrl && logoBase64 && (
            <Image style={{ position: 'absolute', left: settings.logoX, top: settings.logoY, width: settings.logoWidth, height: settings.logoHeight }} src={logoBase64} />
          )}
          {settings.brandVisible && settings.brandText ? (
            <Text style={{ position: 'absolute', left: settings.brandX, top: settings.brandY, fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.white }}>{settings.brandText}</Text>
          ) : null}
          {settings.instructorVisible && settings.instructorText ? (
            <Text style={{ position: 'absolute', left: settings.instructorX, top: settings.instructorY, fontSize: 7, color: 'rgba(255,255,255,0.55)' }}>{settings.instructorText}</Text>
          ) : null}
          {settings.websiteVisible && settings.websiteText ? (
            <Text style={{ position: 'absolute', left: settings.websiteX, top: settings.websiteY, fontSize: 7, color: 'rgba(255,255,255,0.55)' }}>{settings.websiteText}</Text>
          ) : null}
          {settings.titleVisible && settings.titleText ? (
            <Text style={{ position: 'absolute', left: settings.titleX, top: settings.titleY, fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#90CAF9', letterSpacing: 1.2 }}>{settings.titleText}</Text>
          ) : null}
          {settings.subtitleVisible && settings.subtitleText ? (
            <View style={{ position: 'absolute', left: settings.subtitleX, top: settings.subtitleY, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: 'rgba(255,255,255,0.8)' }}>{settings.subtitleText}</Text>
            </View>
          ) : null}
        </View>

        {/* ── Student Info ─────────────────────────────────────────────── */}
        <View style={[s.studentStrip, { backgroundColor: settings.studentStripBg }]}>
          <View style={s.infoCol}>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Student Name</Text>
              <Text style={[s.infoValue, { fontFamily: 'Helvetica-Bold' }]}>{studentName}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Registration ID</Text>
              <Text style={s.infoValue}>{registrationId}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Email</Text>
              <Text style={s.infoValue}>{email}</Text>
            </View>
          </View>
          <View style={s.infoCol}>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Course</Text>
              <Text style={[s.infoValue, { fontFamily: 'Helvetica-Bold', flex: 1 }]}>{courseLabel}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Enrollment Date</Text>
              <Text style={s.infoValue}>{fmtDate(enrolledDate) || '—'}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Issue Date</Text>
              <Text style={s.infoValue}>{todayStr()}</Text>
            </View>
          </View>
        </View>

        {/* ── Status Banner ─────────────────────────────────────────────── */}
        {isComplete ? (
          <View style={s.bannerComplete}>
            <Text style={[s.bannerTitle, { color: '#166534' }]}>{settings.bannerCompleteTitle}</Text>
            <Text style={[s.bannerSub, { color: '#166534' }]}>
              {settings.bannerCompleteSub.replace('[date]', todayStr())}
            </Text>
          </View>
        ) : (
          <View style={s.bannerProgress}>
            <Text style={[s.bannerTitle, { color: '#92400E' }]}>{settings.bannerProgressTitle}</Text>
            <Text style={[s.bannerSub, { color: '#92400E' }]}>
              {settings.bannerProgressSub.replace('[date]', todayStr())}
            </Text>
          </View>
        )}

        {/* ── Session Table ──────────────────────────────────────────────── */}
        <View>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>{courseLabel}</Text>
            <View style={s.sectionLine} />
          </View>
          <CourseTable courseId={courseId} progressMap={progressMap} settings={settings} />
        </View>

        {/* ── Summary Boxes ──────────────────────────────────────────────── */}
        <CourseSummaryBoxes
          courseId={courseId}
          progressMap={progressMap}
          cert={certs.get(courseId) ?? null}
          certBorderColor={certs.has(courseId) ? C.green : C.border}
        />

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <View style={[s.footer, { backgroundColor: settings.footerBgColor }]} fixed>
          {settings.footerLeftVisible && settings.footerLeftText ? (
            <Text style={s.footerText}>{settings.footerLeftText.replace('[date]', todayStr())}</Text>
          ) : <Text />}
          {settings.footerMidVisible && settings.footerMidText ? (
            <Text style={[s.footerText, { flex: 1, textAlign: 'center' }]}>{settings.footerMidText}</Text>
          ) : <Text style={{ flex: 1 }} />}
          {settings.footerRightVisible && settings.footerRightText ? (
            <Text style={s.footerText}>{settings.footerRightText}</Text>
          ) : <Text />}
        </View>

      </Page>
    </Document>
  );
}

// ── Route Handler ─────────────────────────────────────────────────────────────

function getEnrolledCourses(courseValue: string): string[] {
  if (courseValue === 'both') return ['3sfm', 'bvm'];
  if (courseValue === 'bvm') return ['bvm'];
  return ['3sfm'];
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const regId      = searchParams.get('regId')?.trim() ?? '';
  const email      = searchParams.get('email')?.trim().toLowerCase() ?? '';
  const courseParam = searchParams.get('course')?.trim().toLowerCase() ?? '';

  // ── Preview mode — bypasses Apps Script, uses sample data ────────────────
  if (searchParams.get('preview') === 'true') {
    const settings  = await loadTranscriptSettings();
    const logoBase64 = (settings.logoVisible && settings.logoUrl)
      ? await loadLogoBase64(settings.logoUrl)
      : null;

    const previewCourseId = Object.keys(COURSES)[0] ?? '3sfm';
    const course = COURSES[previewCourseId];
    const progressMap = new Map<string, ProgRow>();
    if (course) {
      course.sessions.forEach((sess, idx) => {
        if (!sess.isFinal && idx % 3 !== 2) {
          progressMap.set(sess.id, { sessionId: sess.id, passed: true, score: 70 + (idx * 7 % 25), attempts: idx % 2 === 0 ? 1 : 2 });
        }
      });
    }

    try {
      const buffer = await renderToBuffer(
        <TranscriptDocument
          studentName="Sample Student"
          registrationId="FMP-2026-DEMO"
          email="demo@example.com"
          courseId={previewCourseId}
          enrolledDate={new Date().toISOString()}
          progressMap={progressMap}
          certs={new Map()}
          isComplete={false}
          settings={settings}
          logoBase64={logoBase64}
        />
      );
      return new NextResponse(buffer as unknown as BodyInit, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="FMP-Transcript-Preview.pdf"', 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      console.error('[transcript] preview render error:', err);
      return NextResponse.json({ error: 'Failed to generate preview PDF' }, { status: 500 });
    }
  }

  if (!regId || !email) {
    return NextResponse.json({ error: 'regId and email are required' }, { status: 400 });
  }

  // ── Fetch progress + settings in parallel, then load logo ────────────────
  const [result, settings] = await Promise.all([
    getStudentProgress(email, regId),
    loadTranscriptSettings(),
  ]);
  // Only fetch logo if visible and a URL is set
  const logoBase64 = (settings.logoVisible && settings.logoUrl)
    ? await loadLogoBase64(settings.logoUrl)
    : null;

  if (!result.success || !result.data) {
    return NextResponse.json(
      { error: 'Could not load student progress. Please try again.' },
      { status: 502 },
    );
  }

  const { student, sessions } = result.data;
  const allEnrolled = getEnrolledCourses(student.course ?? '3sfm');

  // Resolve the single course for this transcript
  const courseId = (courseParam && allEnrolled.includes(courseParam))
    ? courseParam
    : allEnrolled[0];

  // ── Build progress map ────────────────────────────────────────────────────
  const progressMap = new Map<string, ProgRow>();
  for (const sess of sessions) {
    progressMap.set(sess.sessionId, {
      sessionId: sess.sessionId,
      passed:    sess.passed,
      score:     sess.score,
      attempts:  sess.attempts,
    });
  }

  // ── Determine completion & fetch certs ───────────────────────────────────
  const certsMap = new Map<string, CertData>();
  let isComplete = false;

  if (result.data.certificateIssued) {
    const certResult = await getCertificatesByEmail(email);
    if (certResult.success && certResult.data) {
      for (const cert of certResult.data) {
        const normCourse = cert.course?.toLowerCase().includes('bvm') ? 'bvm' : '3sfm';
        certsMap.set(normCourse, {
          certificateId: cert.certificateId,
          issuedAt:      cert.issuedAt,
          certifierUrl:  cert.certifierUrl,
        });
      }
      isComplete = true;
    }
  }

  if (!isComplete) {
    const course = COURSES[courseId];
    isComplete = !!course && course.sessions.every(s => progressMap.get(s.id)?.passed);
  }

  // ── Render PDF ─────────────────────────────────────────────────────────────
  try {
    const buffer = await renderToBuffer(
      <TranscriptDocument
        studentName={student.name || regId}
        registrationId={regId}
        email={email}
        courseId={courseId}
        enrolledDate={student.registeredAt ?? ''}
        progressMap={progressMap}
        certs={certsMap}
        isComplete={isComplete}
        settings={settings}
        logoBase64={logoBase64}
      />
    );

    const shortTitle = COURSES[courseId]?.shortTitle ?? courseId.toUpperCase();
    const filename   = `FMP-Transcript-${regId}-${shortTitle}.pdf`;

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
    });
  } catch (err) {
    console.error('[transcript] PDF render error:', err);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
