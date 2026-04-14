-- ============================================================
-- 075: Add contact_items array to contact page for multiple
-- editable email addresses, phone, location, and booking card
-- ============================================================

UPDATE page_sections
SET content = content || $json${
  "contact_items": [
    {
      "type": "email",
      "icon": "\ud83d\udce7",
      "label": "General Inquiries",
      "value": "hello@financialmodelerpro.com",
      "visible": true
    },
    {
      "type": "email",
      "icon": "\ud83c\udf93",
      "label": "Training Support",
      "value": "training@financialmodelerpro.com",
      "visible": true
    },
    {
      "type": "email",
      "icon": "\ud83d\udcbc",
      "label": "Business & Partnerships",
      "value": "ahmad.din@pacemakersglobal.com",
      "visible": true
    },
    {
      "type": "phone",
      "icon": "\ud83d\udcde",
      "label": "Phone",
      "value": "+92 334 999 9194",
      "visible": true
    },
    {
      "type": "location",
      "icon": "\ud83d\udccd",
      "label": "Location",
      "value": "Lahore, Pakistan",
      "visible": true
    }
  ]
}$json$::jsonb
WHERE page_slug = 'contact'
  AND display_order = 2;

-- Update footer founder line default
UPDATE cms_content
SET value = 'Financial Modeler Pro Team'
WHERE section = 'footer'
  AND key = 'founder_line';
