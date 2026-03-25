-- Testimonials
CREATE TABLE IF NOT EXISTS testimonials (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name         text NOT NULL,
  role         text NOT NULL DEFAULT '',
  company      text NOT NULL DEFAULT '',
  text         text NOT NULL,
  rating       int  NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  source       text NOT NULL DEFAULT 'form',
  created_at   timestamptz DEFAULT now(),
  approved_at  timestamptz
);

ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Approved testimonials are public" ON testimonials;
CREATE POLICY "Approved testimonials are public" ON testimonials FOR SELECT USING (status = 'approved');
DROP POLICY IF EXISTS "Admin full access on testimonials" ON testimonials;
CREATE POLICY "Admin full access on testimonials" ON testimonials FOR ALL USING (true);

-- Contact submissions
CREATE TABLE IF NOT EXISTS contact_submissions (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name       text NOT NULL,
  email      text NOT NULL,
  subject    text NOT NULL DEFAULT '',
  message    text NOT NULL,
  read       boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin reads contact submissions" ON contact_submissions;
CREATE POLICY "Admin reads contact submissions" ON contact_submissions FOR ALL USING (true);
DROP POLICY IF EXISTS "Anyone can submit contact" ON contact_submissions;
CREATE POLICY "Anyone can submit contact" ON contact_submissions FOR INSERT WITH CHECK (true);
