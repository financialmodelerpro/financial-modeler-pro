'use client';

/**
 * ArticleAuthorAboutFields.tsx (admin, client)
 *
 * "About the author" inputs for both article forms (new + edit): a bio textarea
 * and a profile-link input that feed the end-of-article author block (mig 195).
 * Leaving the bio blank makes the API snapshot the linked writer's instructor bio,
 * so the common founder case needs no typing; a different author is written up by
 * hand here. Presentation only; the values are sent as author_bio /
 * author_profile_url in the article save payload.
 *
 * No em dashes in this file.
 */

interface Props {
  bio: string;
  profileUrl: string;
  onChange: (patch: Partial<{ bio: string; profileUrl: string }>) => void;
  inputStyle: React.CSSProperties;
}

export function ArticleAuthorAboutFields({ bio, profileUrl, onChange, inputStyle }: Props): React.JSX.Element {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 20 }} data-testid="article-author-about">
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1B3A6B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>About the author</div>
      <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 14 }}>Shown at the end of the article. Leave the bio blank to use the writer&apos;s instructor bio.</div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>Bio</label>
        <textarea value={bio} onChange={(e) => onChange({ bio: e.target.value })} rows={4} placeholder="Defaults to the writer's instructor bio" data-testid="author-bio"
          style={{ ...inputStyle, resize: 'vertical' }} />
      </div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>Profile link</label>
        <input value={profileUrl} onChange={(e) => onChange({ profileUrl: e.target.value })} placeholder="/about/ahmad-din" data-testid="author-profile-url" style={inputStyle} />
      </div>
    </div>
  );
}
