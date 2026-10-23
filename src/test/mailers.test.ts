import { describe, expect, it } from 'vitest';
import { localizedMessage, localizedSubject } from '../lib/mailers';
import { dict, fill } from '../lib/i18n';

const title = 'Retainer Agreement';

describe('localizedSubject', () => {
  it('translates the default subject into the signer’s language', () => {
    const doc = { title, subject: fill(dict('th').defSubject, { title }) };
    expect(localizedSubject(doc, 'en')).toBe(`Please sign: ${title}`);
    expect(localizedSubject(doc, 'th')).toBe(`กรุณาลงนาม: ${title}`);
  });
  it('uses the default when the subject is empty', () => {
    expect(localizedSubject({ title, subject: '  ' }, 'en')).toBe(`Please sign: ${title}`);
  });
  it('leaves a subject the sender wrote untouched', () => {
    expect(localizedSubject({ title, subject: 'สัญญาจ้าง / Engagement letter' }, 'en')).toBe('สัญญาจ้าง / Engagement letter');
  });
});

describe('localizedMessage', () => {
  it('translates the default message, keeps a custom one', () => {
    expect(localizedMessage({ message: dict('th').defMsg }, 'en')).toBe(dict('en').defMsg);
    expect(localizedMessage({ message: 'Dear Mr. Smith, please sign by Friday.' }, 'th')).toBe('Dear Mr. Smith, please sign by Friday.');
  });
});
