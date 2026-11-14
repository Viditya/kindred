// Shared compatibility engine (same formula as the web app)
export const PEOPLE = [
  { n: 'Ananya', a: 27, c: 'Indiranagar', job: 'Product Designer', intent: ['Coffee chats', 'Dating', 'Travel buddies'], interests: ['Photography', 'Cafés', 'Live music', 'Travel', 'Books'], q: { weekend: 'Café + a book', social: 'Deep chat in a corner', values: 'Curiosity', pace: 'Let it flow' }, sig: 4 },
  { n: 'Rohan', a: 30, c: 'Koramangala', job: 'Founder, climate-tech', intent: ['Treks & outdoors', 'Friendship', 'Coffee chats'], interests: ['Trekking', 'Startups', 'AI & Tech', 'Running', 'Documentaries'], q: { weekend: 'Sunrise trek', social: 'The one starting conversations', values: 'Ambition', pace: "Spontaneous — let's go!" }, sig: 5 },
  { n: 'Meera', a: 29, c: 'Jayanagar', job: 'Classical vocalist', intent: ['Marriage-minded', 'Friendship'], interests: ['Indian classical', 'Cooking', 'Books', 'Volunteering', 'Family'], q: { weekend: 'Brunch with friends', social: 'Deep chat in a corner', values: 'Kindness', pace: 'Slow & steady' }, sig: 3 },
  { n: 'Kabir', a: 32, c: 'Whitefield', job: 'ML Engineer', intent: ['Travel buddies', 'Treks & outdoors', 'Dating'], interests: ['AI & Tech', 'Cycling', 'Books', 'Travel', 'Live music'], q: { weekend: 'Sunrise trek', social: 'Running the playlist', values: 'Curiosity', pace: 'Let it flow' }, sig: 4 },
  { n: 'Ishita', a: 28, c: 'Malleshwaram', job: 'Architect', intent: ['Travel buddies', 'Treks & outdoors', 'Friendship'], interests: ['Trekking', 'Photography', 'Travel', 'Books'], q: { weekend: 'Sunrise trek', social: 'Running the playlist', values: 'Curiosity', pace: "Spontaneous — let's go!" }, sig: 5 },
  { n: 'Arjun', a: 31, c: 'Hebbal', job: 'Chartered Accountant', intent: ['Marriage-minded', 'Coffee chats'], interests: ['Cricket', 'Running', 'Family', 'Cooking', 'Startups'], q: { weekend: 'Brunch with friends', social: 'Deep chat in a corner', values: 'Kindness', pace: 'Slow & steady' }, sig: 3 },
];

export const MEETUPS = [
  { t: 'Nandi Hills Sunrise Trek', type: 'Treks & outdoors', when: 'Sun 4:30 AM', min: 60, tags: ['Trekking', 'Photography'] },
  { t: "Founders' Filter Coffee Chat", type: 'Coffee chats', when: 'Sat 10 AM', min: 60, tags: ['Startups', 'Cafés', 'AI & Tech'] },
  { t: 'Silent Book Club, Cubbon Park', type: 'Friendship', when: 'Sun 5 PM', min: 60, tags: ['Books'] },
  { t: 'Coorg Weekend Escape', type: 'Travel buddies', when: 'Dec 5–7', min: 80, tags: ['Travel', 'Trekking'] },
  { t: 'Family-Values Mixer', type: 'Marriage-minded', when: 'Sun 11 AM', min: 80, tags: ['Family', 'Indian classical', 'Cooking'] },
];

export function compat(me, p) {
  const mine = new Set(Object.keys(me.interests));
  const shared = p.interests.filter((i) => mine.has(i));
  const union = new Set([...mine, ...p.interests]).size || 1;
  const interest = Math.round(Math.min(1, (shared.length / union) * 2.4) * 100);
  const myIntent = me.profile.intent || [];
  const iShared = p.intent.filter((i) => myIntent.includes(i));
  const intent = myIntent.length ? Math.round((iShared.length / Math.min(myIntent.length, p.intent.length)) * 100) : 50;
  let m = 0, n = 0;
  for (const k of ['weekend', 'social', 'values', 'pace']) if (me.profile.answers?.[k]) { n++; if (me.profile.answers[k] === p.q[k]) m++; }
  const values = n ? Math.round(40 + (60 * m) / n) : 50;
  const social = Math.round(Math.min(1, (me.channels / 5) * 0.5 + (p.sig / 5) * 0.5) * 100);
  return { total: Math.round(interest * 0.35 + intent * 0.3 + values * 0.25 + social * 0.1), interest, intent, values, social, shared };
}
