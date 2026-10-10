// Privacy Policy and Terms of Service for usecommon.app. The Vite plugin in vite.config.ts renders
// these into /privacy and /terms as standalone public pages. Drafts for a solo, free side project
// based in India; have them reviewed before a wide launch.

export const LEGAL = {
  owner: 'Mayank Bansal',
  country: 'India',
  contact: 'mayankbansal125@gmail.com',
  effective: '11 October 2026',
} as const;

export type LegalDoc = {
  slug: 'privacy' | 'terms';
  title: string;
  description: string;
  intro: string;
  sections: { heading: string; html: string }[];
};

const mail = `<a href="mailto:${LEGAL.contact}">${LEGAL.contact}</a>`;

export const PRIVACY: LegalDoc = {
  slug: 'privacy',
  title: 'Privacy Policy',
  description: 'How Common collects, uses and protects your information.',
  intro: `Common is a free side project built and run by ${LEGAL.owner}, an individual developer in ${LEGAL.country} (“I”, “me”). This policy explains what Common collects, why, who can see it, and the choices you have. It’s written to be read, so it’s short.`,
  sections: [
    {
      heading: 'What Common collects',
      html: `<ul>
<li><strong>Your account:</strong> your email address and the name you use. If you sign in with Google, Google shares your name and email address with Common; nothing else from your Google account.</li>
<li><strong>Your profile and spaces:</strong> your display name, your avatar choice, and any photos you upload for yourself or a space, along with space names, icons and colours.</li>
<li><strong>What you share:</strong> the messages you send, the email addresses of people you invite, and a short activity history for each space (for example, who joined or renamed it).</li>
<li><strong>What’s needed to run the app:</strong> your sign-in sessions, which messages you’ve read (for unread counts), a few seconds of “is typing” status while you write, and the routine technical logs (such as IP address and browser) that hosting providers keep for security and reliability.</li>
</ul>
<p>Common has no ads, no tracking or analytics, and doesn’t sell or rent your information.</p>`,
    },
    {
      heading: 'How it’s used',
      html: `<p>Only to run Common: to sign you in, to show your messages and profile to the people in your spaces, to send sign-in codes and invitation emails, to keep the service secure (for example, limiting how fast messages can be sent), and to reply when you get in touch. Your messages are not used to train AI models.</p>`,
    },
    {
      heading: 'Who can see your information',
      html: `<ul>
<li><strong>People in your spaces</strong> see your name, avatar or photo, email address, and the messages and activity in spaces you share with them.</li>
<li><strong>People you invite</strong> receive an email naming you and the space. Until they join, other members see only a masked version of their address.</li>
<li><strong>Me:</strong> I don’t read your messages. I may access data only when needed to fix a problem, deal with abuse, or meet a legal obligation.</li>
<li><strong>Service providers</strong> who run parts of Common on my behalf, listed below.</li>
</ul>`,
    },
    {
      heading: 'Service providers',
      html: `<p>Common relies on a few providers, who process your information only to provide their service:</p>
<ul>
<li><strong>Convex</strong> stores Common’s data, including messages and photos, and runs its backend.</li>
<li><strong>Vercel</strong> hosts the website.</li>
<li><strong>Resend</strong> sends sign-in codes and invitation emails.</li>
<li><strong>Google</strong>, only if you choose to sign in with Google.</li>
</ul>
<p>These providers may store and process data outside ${LEGAL.country}, including in the United States.</p>`,
    },
    {
      heading: 'Security, and what “private” means here',
      html: `<p>Connections to Common are encrypted (HTTPS), and access to each space is limited to its members. Messages are <strong>not end-to-end encrypted</strong>: they’re stored on Convex’s servers, protected by access controls. Please don’t use Common for information that needs stronger protection than that.</p>`,
    },
    {
      heading: 'On your device',
      html: `<p>Common stores a few things in your browser so it works smoothly: your sign-in session, messages waiting to send, unsent drafts, and a copy of your spaces list so the app opens quickly. Signing out clears your session and the cached list. Common doesn’t use advertising or tracking cookies.</p>`,
    },
    {
      heading: 'How long it’s kept',
      html: `<p>Your information is kept while your account exists. Sign-in codes expire after 10 minutes, typing status after a few seconds, and invitations after 7 days. If you ask me to delete your account, I’ll delete your account, profile, photos and the messages you’ve sent within 30 days, except where I’m required by law to keep something.</p>`,
    },
    {
      heading: 'Your rights',
      html: `<p>Under India’s Digital Personal Data Protection Act, 2023, you can ask to access, correct or erase your personal data, withdraw consent, and nominate someone to exercise these rights for you. Email ${mail} and I’ll respond within 30 days. You can update your name and photo yourself under Edit profile.</p>
<p><strong>Grievances:</strong> ${LEGAL.owner}, ${mail}. If you’re not satisfied with my response, you may complain to the Data Protection Board of India.</p>`,
    },
    {
      heading: 'Age',
      html: `<p>You should be 18 or older to use Common, or have permission from a parent or guardian. If I learn that a child is using Common without that permission, I’ll delete their account.</p>`,
    },
    {
      heading: 'Changes',
      html: `<p>If this policy changes, I’ll update the date at the top and, for significant changes, let you know in the app or by email before they take effect.</p>`,
    },
    {
      heading: 'Contact',
      html: `<p>Questions or requests: ${mail}.</p>`,
    },
  ],
};

export const TERMS: LegalDoc = {
  slug: 'terms',
  title: 'Terms of Service',
  description: 'The rules for using Common.',
  intro: `Common is a free side project built and run by ${LEGAL.owner}, an individual developer in ${LEGAL.country} (“I”, “me”). By using Common, you agree to these terms. Please read them along with the <a href="/privacy">Privacy Policy</a>.`,
  sections: [
    {
      heading: 'Who can use Common',
      html: `<p>You should be 18 or older, or have permission from a parent or guardian. You’re responsible for your account and for what happens in it, so keep access to your email secure. One account per person, please.</p>`,
    },
    {
      heading: 'Your content',
      html: `<p>Your messages, photos and other content stay yours. You give Common permission to store, process and show that content to the people in the spaces where you share it, only as needed to run the service. You’re responsible for what you post, and for having the right to share it.</p>`,
    },
    {
      heading: 'Spaces and invitations',
      html: `<p>A space is shared by its members: they can see each other’s names, photos and email addresses, and everything posted there. Only invite people who’d want to be invited. A space’s owner can remove members.</p>`,
    },
    {
      heading: 'What’s not allowed',
      html: `<ul>
<li>Anything illegal, or that encourages illegal activity.</li>
<li>Harassment, threats, hate, or sharing someone’s private information without their consent.</li>
<li>Sexual content involving minors, in any form.</li>
<li>Spam, scams, impersonation, or malware.</li>
<li>Infringing others’ intellectual property.</li>
<li>Trying to break, overload, scrape or get around Common’s security or limits.</li>
</ul>`,
    },
    {
      heading: 'Removal and ending your account',
      html: `<p>I may remove content or suspend accounts that break these terms, or to protect people or the service. You can stop using Common at any time; email ${mail} to have your account deleted.</p>`,
    },
    {
      heading: 'A free side project, provided as is',
      html: `<p>Common is free and provided “as is”, without warranties. I’ll do my best to keep it running and your data safe, but it may change, be interrupted, or stop entirely. If Common is shutting down, I’ll try to give you notice. Keep your own copy of anything important.</p>`,
    },
    {
      heading: 'Liability',
      html: `<p>To the fullest extent the law allows, I’m not liable for indirect, incidental or consequential losses, or for lost data, profits or goodwill, arising from your use of Common. Nothing in these terms limits liability that can’t be limited by law.</p>`,
    },
    {
      heading: 'Other services',
      html: `<p>Common works with services run by others, such as Google sign-in and email delivery. Their own terms apply when you use them.</p>`,
    },
    {
      heading: 'Changes',
      html: `<p>If these terms change, I’ll update the date at the top and, for significant changes, let you know in the app or by email before they take effect. Continuing to use Common afterwards means you accept the new terms.</p>`,
    },
    {
      heading: 'Governing law',
      html: `<p>These terms are governed by the laws of ${LEGAL.country}, and the courts of ${LEGAL.country} have jurisdiction over any disputes.</p>`,
    },
    {
      heading: 'Contact',
      html: `<p>Questions about these terms: ${mail}.</p>`,
    },
  ],
};
