-- Student-submitted testimonials (separate from manual testimonials table)
CREATE TABLE IF NOT EXISTS student_testimonials (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  registration_id     text NOT NULL,
  student_name        text NOT NULL,
  student_email       text NOT NULL,
  course_code         text NOT NULL,
  course_name         text NOT NULL DEFAULT '',
  testimonial_type    text NOT NULL CHECK (testimonial_type IN ('written', 'video')),
  written_content     text,
  rating              integer CHECK (rating BETWEEN 1 AND 5),
  video_url           text,
  video_thumbnail_url text,
  linkedin_url        text,
  job_title           text,
  company             text,
  location            text,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  is_featured         boolean DEFAULT false,
  admin_notes         text,
  approved_by         text,
  approved_at         timestamptz,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE student_testimonials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students insert student testimonials" ON student_testimonials;
CREATE POLICY "Students insert student testimonials" ON student_testimonials
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Admin full access on student_testimonials" ON student_testimonials;
CREATE POLICY "Admin full access on student_testimonials" ON student_testimonials
  FOR ALL USING (true);

DROP POLICY IF EXISTS "Public read approved student testimonials" ON student_testimonials;
CREATE POLICY "Public read approved student testimonials" ON student_testimonials
  FOR SELECT USING (status = 'approved');
