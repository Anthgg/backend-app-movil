const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\anthg\\.gemini\\antigravity\\brain';

function scanDir(dir) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath);
    } else if (item === 'overview.txt' || item.endsWith('.md') || item.endsWith('.json')) {
      try {
        let content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('\u0000')) {
          content = fs.readFileSync(fullPath, 'utf16le');
        }
        
        if (content.includes('pwukbujyinlgqsafreqe') || content.includes('supabase.co')) {
          const lines = content.split('\n');
          lines.forEach((line, index) => {
            if (line.includes('pwukbujyinlgqsafreqe') || line.includes('DATABASE_URL') || line.includes('password') || line.includes('postgres')) {
              console.log(`Found in ${path.basename(dir)}/logs/${item}:${index+1}: ${line.trim().substring(0, 150)}`);
            }
          });
        }
      } catch (err) {
        // Ignore
      }
    }
  }
}

scanDir(brainDir);
console.log('Scan complete.');
