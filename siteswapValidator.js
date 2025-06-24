/**
 * Returns true if the siteswap string is valid, false if not.
 * Accepts vanilla, multiplex, synchronous, and synchronous multiplex patterns.
 */
function validateSiteswap(siteswap) {
  // Preprocess input
  siteswap = siteswap.replace(/\s/g, '').split('2t').join('2'); // Clean spaces and handle '2t'

  let type = "";
  let max = 0;

  // Determine pattern type
  if (siteswap.match(/^[a-z\d]+$/))
    type = 'vanilla';
  else if (siteswap.match(/^([0-9a-z]*(\[[0-9a-z]{2,}\])+[0-9a-z]*)+$/))
    type = 'multiplex';
  else if (siteswap.match(/^(\([02468acegikmoqsuwy]x?,[02468acegikmoqsuwy]x?\))+\*?$/))
    type = 'synchronous';
  else if (siteswap.match(/^(\(([02468acegikmoqsuwyx]x?|\[[02468acegikminioqsuwyx]{2,}\]),([02468acegikmoqsuwy]x?|\[[02468acegikmoqsuwyx]{2,}\])\))+\*?$/))
    type = 'synchronous multiplex';
  else
    return false;

  // Allowed characters
  if (siteswap.match(/[^a-z0-9\[\]\(\)\,\*]/)) return false;

  // Only allow commas in synchronous siteswaps
  if (siteswap.indexOf(',') > -1 && (type == 'vanilla' || type == 'multiplex'))
    return false;

  // Check correct use of asterisks and commas
  if (type == 'synchronous' || type == 'synchronous multiplex') {
    const asterisk = (siteswap.match(/\*/g) || []).length;
    if (asterisk > 1 || (asterisk == 1 && siteswap.substring(siteswap.length - 1, siteswap.length) != '*'))
      return false;
  } else {
    if (siteswap.indexOf(',') > -1) return false;
    if (siteswap.indexOf('*') > -1) return false;
  }

  // Multiplex validation.
  if (siteswap.match(/\[[0-9a-z\(\),]*\[/)) return false; // Nested
  if (siteswap.match(/\[[0-9a-z\(\),]*($|\[)/)) return false; // Not closed
  if (siteswap.match(/(^|\])[0-9a-z\(\),]*\]/)) return false; // Not opened
  if (siteswap.match(/\[[0-9a-z]*[\(\)\,]+[0-9a-z]*\]/)) return false; // Sync in mux
  if (siteswap.match(/\[[0-9a-z]?\]/)) return false; // Only one throw in mux

  // Sync validation
  if (type == 'synchronous' || type == 'synchronous multiplex') {
    const crossingEvens = (siteswap.match(/([02468acegikmoqsuwy]x)/) == null) ? 0 : siteswap.match(/([02468acegikmoqsuwy]x)/).length;
    const odds = (siteswap.match(/[13579bdfhjlnprtvxz]/) == null) ? 0 : siteswap.match(/[13579bdfhjlnprtvxz]/).length;
    if (odds > crossingEvens) return false;
    if (siteswap.match(/(^|\))[^\(\)\*]+(\(|\*|$)/)) return false;
    if (siteswap.match(/\([0-9a-z\[\],]*($|\()/)) return false;
    if (siteswap.match(/(^|\))[0-9a-z\[\],]*\)/)) return false;
    if (siteswap.match(/\([^,]*\)/)) return false;
    if (siteswap.match(/\([0-9a-z\[\],]*,+[0-9a-z\[\],]*,+[0-9a-z\[\],]*\)/)) return false;
    if (siteswap.match(/\((([0-9a-z\[\]]+\[[0-9a-z\(\),]*\])|(\[[0-9a-z\(\),]*\][0-9a-z\[\]]+)|([0-9a-z]{3})|([0-9a-z][^x,]))?,/) ||
        siteswap.match(/,(([0-9a-z\[\]]+\[[0-9a-z\(\),]*\])|(\[[0-9a-z\(\),]*\][0-9a-z\[\]]+)|([0-9a-z]{3})|([0-9a-z][^x,]))?\)/))
      return false;
  }

  // Expand sync siteswap if it ends with an asterisk
  if (siteswap.indexOf('*') > -1) {
    siteswap = siteswap.substring(0, siteswap.length - 1);
    let working = siteswap;
    while (working.indexOf('(') > -1) {
      const openingBrace = working.indexOf('(');
      const comma = working.indexOf(',');
      const closingBrace = working.indexOf(')');
      siteswap += '(' + working.substring(comma + 1, closingBrace) + ',' + working.substring(openingBrace + 1, comma) + ')';
      working = working.substring(closingBrace + 1);
    }
  }

  // Double the pattern if the period is odd
  let double = false;
  if ((type == 'vanilla' && siteswap.length % 2 === 1) || (type == 'multiplex' && siteswap.replace(/\[\w+\]/g, '1').length % 2 === 1)) {
    double = true;
    siteswap += siteswap;
  }

  // Convert to numeric values and analyze pattern
  function getVal(c) {
    const v = c.match(/^[0-9]$/) ? parseInt(c) : c.charCodeAt(0) - 87;
    if (v > max) max = v;
    return v;
  }

  const left = [], right = [];
  let a = 0, b = 0, sync = 0, mux = false, hand = 0;

  for (let i = 0; i < siteswap.length; i++) {
    const char = siteswap[i];
    if (char == '(') sync = 1;
    else if (char == ',') sync = 2;
    else if (char == '[') mux = true;
    else if (char == ']') {
      mux = false;
      if (sync == 0) { a++; b++; hand++; }
      else if (sync == 1) a++;
      else b++;
    } else {
      if (!left[a]) left[a] = [];
      if (!right[b]) right[b] = [];
      if (char == ')') {
        sync = 0;
        left[a++] = [0];
        right[b++] = [0];
      } else {
        let value;
        if (sync == 1 || sync == 2 || mux) {
          value = getVal(char);
          if (value % 2 === 0 && siteswap[i + 1] === 'x') { value *= -1; i++; }
        }
        if (sync == 1) {
          left[a].push(value);
          if (!mux) a++;
        }
        else if (sync == 2) {
          right[b].push(value);
          if (!mux) b++;
        }
        else if (mux) {
          if (hand % 2 == 0) { left[a][left[a].length] = value; right[b][0] = 0; }
          else { right[b][right[b].length] = value; left[a][0] = 0; }
        }
        else {
          if (hand++ % 2 == 0) { left[a++] = [getVal(char)]; right[b++] = [0]; }
          else { right[b++] = [getVal(char)]; left[a++] = [0]; }
        }
      }
    }
  }

  // Average rule (sum/num must be integer)
  let sum = 0, num = 0;
  for (const l of left) { for (const v of l) sum += Math.abs(v); num++; }
  for (const r of right) { for (const v of r) sum += Math.abs(v); }
  if (double) num /= 2;
  if ((sum % num) !== 0) return false;

  // Check number in = number out at every index
  const outLeft = [], outRight = [], inLeft = [], inRight = [];
  const period = left.length;
  for (let i = 0; i < period; i++) inLeft[i] = inRight[i] = 0;
  for (let i = 0; i < period; i++) {
    outLeft[i] = (left[i][0] === 0) ? 0 : left[i].length;
    outRight[i] = (right[i][0] === 0) ? 0 : right[i].length;
    left[i].forEach(t => {
      const value = Math.abs(t);
      if (t > 0 && t % 2 === 0) inLeft[(i + value) % period]++;
      else if (t !== 0) inRight[(i + value) % period]++;
    });
    right[i].forEach(t => {
      const value = Math.abs(t);
      if (t > 0 && t % 2 === 0) inRight[(i + value) % period]++;
      else if (t !== 0) inLeft[(i + value) % period]++;
    });
  }
  for (let i = 0; i < period; i++)
    if (inLeft[i] !== outLeft[i] || inRight[i] !== outRight[i]) return false;

  return true;
}

module.exports = validateSiteswap;

// Example usage:
// console.log(validateSiteswap("531")); // true
// console.log(validateSiteswap("(4,4)(4,0)*")); // true
// console.log(validateSiteswap("54312")); // false