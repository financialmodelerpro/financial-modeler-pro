-- ============================================================
-- 062: Seed home page PaceMakers section into page_sections
-- ============================================================

DELETE FROM page_sections
WHERE page_slug = 'home'
AND section_type = 'columns'
AND content->>'heading' LIKE '%PaceMakers%';

INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'columns', 8, true,
 '{"badge":"The Firm Behind the Platform","heading":"Powered by PaceMakers Business Consultants","description":"Financial Modeler Pro is a product of PaceMakers — a corporate finance advisory firm with 12+ years of experience delivering institutional-grade financial solutions across KSA and Pakistan.","cta_text":"Visit PaceMakers →","cta_url":"https://www.pacemakersglobal.com","services":[{"id":"svc_1","text":"Financial Modeling & Valuation"},{"id":"svc_2","text":"Transaction Advisory & Due Diligence"},{"id":"svc_3","text":"Fractional CFO Services"},{"id":"svc_4","text":"Investment Analysis & Feasibility"}]}',
 '{"bgColor":"#0A2248","textColor":"#ffffff","paddingY":"88px"}');
