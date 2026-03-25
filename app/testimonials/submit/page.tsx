/**
 * /testimonials/submit — Public testimonial submission page
 */
import { Navbar } from '@/src/components/layout/Navbar';
import { TestimonialSubmitForm } from './TestimonialSubmitForm';

export const metadata = {
  title: 'Share Your Experience — Financial Modeler Pro',
  description: 'Submit a testimonial for Financial Modeler Pro.',
};

export default function TestimonialSubmitPage() {
  return (
    <div style={{ fontFamily:"'Inter',-apple-system,sans-serif", background:'#F5F7FA', minHeight:'100vh', color:'#374151' }}>
      <Navbar navPages={[]} topOffset={0} />
      <div style={{ height:64 }} />

      {/* Hero */}
      <section style={{ background:'linear-gradient(180deg,#0D2E5A 0%,#0A2448 100%)', padding:'64px 40px 56px', textAlign:'center', color:'#fff' }}>
        <div style={{ maxWidth:640, margin:'0 auto' }}>
          <div style={{ fontSize:12, fontWeight:700, color:'rgba(255,255,255,0.5)', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:12 }}>
            Community Feedback
          </div>
          <h1 style={{ fontSize:'clamp(26px,4vw,40px)', fontWeight:800, color:'#fff', marginBottom:14, lineHeight:1.15 }}>
            Share Your Experience
          </h1>
          <p style={{ fontSize:15, color:'rgba(255,255,255,0.55)', lineHeight:1.7, maxWidth:500, margin:'0 auto' }}>
            Tell us how Financial Modeler Pro has helped your work. Approved testimonials will appear on our homepage.
          </p>
        </div>
      </section>

      {/* Form */}
      <section style={{ padding:'56px 40px 80px' }}>
        <div style={{ maxWidth:600, margin:'0 auto' }}>
          <TestimonialSubmitForm />
        </div>
      </section>
    </div>
  );
}
