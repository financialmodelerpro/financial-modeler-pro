-- Migration 095: Update home page text_image sections (What is FMP, Mission, Vision)

-- 1. Update "What is Financial Modeler Pro?" section
UPDATE page_sections
SET
  content = content || $json${
    "body": "Financial Modeler Pro is a professional-grade financial modeling platform built by a practitioner with 12+ years of real deal experience across KSA, GCC, and Pakistan.\n\nIt combines two integrated platforms in one destination - a Training Hub offering 100% free professional certification in financial modeling, and a Modeling Hub (launching soon) providing institutional-grade tools to build, analyze, and export financial models across multiple disciplines.\n\nEvery model is structured for real-world use. Every assumption is traceable. Every output is investor-ready. And every model can be exported into a fully formula-linked Excel workbook or a clean, presentation-ready investor PDF - ready to share from day one.\n\nWhether you are an analyst learning to build your first 3-statement model, or a senior advisor structuring a multi-billion riyal real estate deal, Financial Modeler Pro gives you both the knowledge and the tools in one place.",
    "items": [
      "Multi-discipline modeling - real estate, valuation, FP&A, project finance, LBO, and more",
      "Structured workflows - from assumptions to investor-ready outputs",
      "Monthly or annual modeling with full period control",
      "Formula-linked Excel export + investor PDF reports",
      "100% free professional certification program",
      "Built by a practitioner, not a software company"
    ]
  }$json$::jsonb,
  styles = COALESCE(styles, '{}'::jsonb) || '{"maxWidth": "1200px"}'::jsonb,
  updated_at = now()
WHERE page_slug = 'home'
  AND section_type = 'text_image'
  AND content::text LIKE '%What is Financial Modeler%';

-- 2. Update "Our Mission" section
UPDATE page_sections
SET
  content = content || $json${
    "body": "To make professional financial modeling accessible to every finance professional worldwide. We believe structured, real-world modeling skills should not be locked behind expensive courses or years of trial and error. That is why our certification program is 100% free - always. And our modeling tools are built to do in hours what used to take months."
  }$json$::jsonb,
  updated_at = now()
WHERE page_slug = 'home'
  AND section_type = 'text_image'
  AND content::text LIKE '%Our Mission%';

-- 3. Update "Our Vision" section
UPDATE page_sections
SET
  content = content || $json${
    "body": "To become the go-to financial modeling platform for practitioners, advisory firms, and finance teams across the GCC and beyond - where professionals come to learn, build, and deliver institutional-grade financial models across every discipline. One platform for knowledge and execution."
  }$json$::jsonb,
  updated_at = now()
WHERE page_slug = 'home'
  AND section_type = 'text_image'
  AND content::text LIKE '%Our Vision%';
