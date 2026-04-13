-- ============================================================
-- 058: Seed home page "Two Platforms" into page_sections
-- Text editable via Admin CMS; layout stays hardcoded
-- ============================================================

DELETE FROM page_sections
WHERE page_slug = 'home'
AND section_type = 'columns'
AND content->>'heading' LIKE '%Two Platforms%';

INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'columns', 6, true,
 '{"heading":"Two Platforms. One Destination.","subheading":"Modeling + Training — everything a financial professional needs in one place.","columns":[{"id":"modeling","title":"Modeling Platform","description":"Structured workflows that take you from project setup to investor-ready reports. All outputs link — change one assumption, everything updates.","borderColor":"#1B4F8A","borderSideColor":"#C7D9F2","accentColor":"#1B4F8A","shadowColor":"rgba(27,79,138,0.06)","features":["Multi-discipline project structure","Debt & equity scheduling","IRR, NPV, and equity multiple","Excel & PDF export"],"ctaText":"Explore Modeling Hub →","ctaUrl":"/modeling","icon":"<svg width=\"48\" height=\"48\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"4\" y=\"26\" width=\"10\" height=\"18\" rx=\"3\" fill=\"#1B4F8A\"/><rect x=\"19\" y=\"16\" width=\"10\" height=\"28\" rx=\"3\" fill=\"#1B4F8A\" fill-opacity=\"0.65\"/><rect x=\"34\" y=\"6\" width=\"10\" height=\"38\" rx=\"3\" fill=\"#1B4F8A\" fill-opacity=\"0.35\"/><line x1=\"2\" y1=\"46\" x2=\"46\" y2=\"46\" stroke=\"#1B4F8A\" stroke-width=\"2.5\" stroke-linecap=\"round\"/></svg>"},{"id":"training","title":"Training Hub","description":"Free video courses taught by finance professionals. Learn the methodology behind the model — from first principles to advanced deal structuring.","borderColor":"#1A7A30","borderSideColor":"#C3E9CE","accentColor":"#1A7A30","shadowColor":"rgba(26,122,48,0.06)","features":["Always 100% free","Real-world case studies","GCC & international markets","Certificate on completion"],"ctaText":"Browse Free Courses →","ctaUrl":"/training","icon":"<svg width=\"48\" height=\"48\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M24 10L6 20L24 30L42 20L24 10Z\" fill=\"#1A7A30\"/><path d=\"M13 25.5V35C13 35 17.5 40 24 40C30.5 40 35 35 35 35V25.5\" stroke=\"#1A7A30\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><line x1=\"42\" y1=\"20\" x2=\"42\" y2=\"32\" stroke=\"#1A7A30\" stroke-width=\"3\" stroke-linecap=\"round\"/><circle cx=\"42\" cy=\"33.5\" r=\"2.5\" fill=\"#1A7A30\"/></svg>"}]}',
 '{"bgColor":"#F5F7FA","paddingY":"88px","maxWidth":"1100px"}');
