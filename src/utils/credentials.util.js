function normalizeNamePart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function firstToken(value) {
  return normalizeNamePart(value).split(' ').filter(Boolean)[0] || '';
}

function compactName(value) {
  return normalizeNamePart(value).replace(/\s+/g, '');
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function generateUsername({ firstName, paternalLastName }) {
  const first = firstToken(firstName);
  const paternal = firstToken(paternalLastName);

  if (!first || !paternal) {
    return compactName([firstName, paternalLastName].filter(Boolean).join(''));
  }

  return `${first}.${paternal}`;
}

function generateUsernameCandidates({ firstName, paternalLastName, maternalLastName }) {
  const first = firstToken(firstName);
  const paternal = firstToken(paternalLastName);
  const maternal = firstToken(maternalLastName);
  const firstInitial = first.charAt(0);
  const paternalInitial = paternal.charAt(0);

  const base = generateUsername({ firstName, paternalLastName });
  const candidates = [
    base,
    first && paternal ? `${first}.${paternal}1` : null,
    first && paternal ? `${first}.${paternal}2` : null,
    firstInitial && paternal ? `${firstInitial}${paternal}` : null,
    first && paternalInitial && maternal ? `${first}.${paternalInitial}.${maternal}` : null,
    first && maternal ? `${first}.${maternal}` : null,
    compactName(`${first}${paternal}`)
  ];

  return uniqueValues(candidates);
}

async function suggestAvailableUsernames(person, usernameExists, limit = 5) {
  const baseCandidates = generateUsernameCandidates(person);
  const suggestions = [];

  for (const candidate of baseCandidates) {
    if (suggestions.length >= limit) {
      break;
    }

    if (!(await usernameExists(candidate))) {
      suggestions.push(candidate);
    }
  }

  const base = generateUsername(person);
  let suffix = 1;
  while (suggestions.length < limit && suffix <= 50) {
    const candidate = `${base}${suffix}`;
    if (!(await usernameExists(candidate)) && !suggestions.includes(candidate)) {
      suggestions.push(candidate);
    }
    suffix += 1;
  }

  return {
    username: suggestions[0] || base,
    username_suggestions: suggestions
  };
}

function generateCorporateEmail(username, domain) {
  const cleanDomain = String(domain || '').trim().toLowerCase().replace(/^@/, '');
  if (!username || !cleanDomain) {
    return null;
  }
  return `${String(username).trim().toLowerCase()}@${cleanDomain}`;
}

module.exports = {
  normalizeNamePart,
  generateUsername,
  generateUsernameCandidates,
  suggestAvailableUsernames,
  generateCorporateEmail
};
