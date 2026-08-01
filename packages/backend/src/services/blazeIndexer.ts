/**
 * blazeIndexer.ts
 *
 * Validates and indexes a Blaze Advisor rules engine repository.
 *
 * Blaze repos are structured with:
 *   TechnicalLibrary/    — rules, functions, decision tables (no file extension)
 *   BusinessLibrary/     — business instances
 *   .innovator_attbs     — fingerprint files present in every Blaze project folder
 *
 * Rule files have NO extension and contain XML-like SRL content.
 * Rule names are extracted from name= attributes in that content.
 */

import * as fs from 'fs';
import * as path from 'path';
import { RuleEntry, RepoValidationResult } from '../types';

// ---------------------------------------------------------------------------
// Blaze fingerprint detection
// ---------------------------------------------------------------------------

const BLAZE_DIRS = ['TechnicalLibrary', 'BusinessLibrary'];
const BLAZE_FINGERPRINT_FILE = '.innovator_attbs';

// Config key patterns in rule bodies (feature flags, CBA keys)
const CONFIG_KEY_PATTERN = /\b([A-Z][A-Z0-9_]{4,}(?:_ENABLED|_FLAG|_EFFECTIVE|_DATE|_KEY|_CONFIG|_TOGGLE|CBA_|CONFIG_)[\w]*)\b/g;

// Hardcoded date patterns
const DATE_PATTERN = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate that a folder is a Blaze Advisor repo.
 *
 * Checks for:
 *   1. TechnicalLibrary/ or BusinessLibrary/ subfolder
 *   2. At least one .innovator_attbs file anywhere in the tree
 */
export function validateRepo(repoPath: string): RepoValidationResult {
  if (!fs.existsSync(repoPath)) {
    return { valid: false, engine: '', rule_files: 0, message: 'Path does not exist' };
  }

  const stat = fs.statSync(repoPath);
  if (!stat.isDirectory()) {
    return { valid: false, engine: '', rule_files: 0, message: 'Path is not a directory' };
  }

  // Check for standard Blaze subfolder names
  const hasBlazeDir = BLAZE_DIRS.some((dir) =>
    fs.existsSync(path.join(repoPath, dir))
  );

  // Check for .innovator_attbs fingerprint (walk up to 3 levels deep)
  const hasFingerprint = findFileRecursive(repoPath, BLAZE_FINGERPRINT_FILE, 3);

  if (!hasBlazeDir && !hasFingerprint) {
    return {
      valid: false,
      engine: '',
      rule_files: 0,
      message: 'No TechnicalLibrary/, BusinessLibrary/, or .innovator_attbs found — does not appear to be a Blaze repo',
    };
  }

  // Count rule files (extension-less files inside the repo)
  const ruleFileCount = countRuleFiles(repoPath);

  return {
    valid:      true,
    engine:     'blaze',
    rule_files: ruleFileCount,
    message:    `Blaze Advisor repo detected (${ruleFileCount} rule files)`,
  };
}

/**
 * Walk the repo and build a map of ruleName → RuleEntry.
 *
 * Scans TechnicalLibrary/ and BusinessLibrary/ (if present) for extension-less
 * files, parses their XML content, and extracts rule names from name= attributes.
 */
export function indexRules(repoPath: string): Map<string, RuleEntry> {
  const ruleMap = new Map<string, RuleEntry>();

  const scanDirs = BLAZE_DIRS
    .map((dir) => path.join(repoPath, dir))
    .filter((dir) => fs.existsSync(dir));

  // Also scan root-level folders not in BLAZE_DIRS that might contain rules
  if (scanDirs.length === 0) {
    scanDirs.push(repoPath);
  }

  for (const scanDir of scanDirs) {
    walkDir(scanDir, (filePath) => {
      const entries = parseRuleFile(filePath, repoPath);
      for (const entry of entries) {
        // Use lowercase name as key for case-insensitive lookup
        ruleMap.set(entry.name.toLowerCase(), entry);
        // Also store under exact case
        if (!ruleMap.has(entry.name)) {
          ruleMap.set(entry.name, entry);
        }
      }
    });
  }

  return ruleMap;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Walk a directory tree and call the callback for every file that looks like
 * a Blaze rule file (no extension, or .rma/.brl extension).
 */
function walkDir(dir: string, callback: (filePath: string) => void): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // skip unreadable directories
  }

  for (const entry of entries) {
    // Skip hidden directories and build artifacts
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkDir(fullPath, callback);
    } else if (entry.isFile() && isRuleFile(entry.name)) {
      callback(fullPath);
    }
  }
}

/**
 * Determine whether a filename looks like a Blaze rule file.
 * Blaze rule files have no extension, or use .rma / .brl.
 */
function isRuleFile(name: string): boolean {
  if (name.startsWith('.')) return false;
  const ext = path.extname(name);
  return ext === '' || ext === '.rma' || ext === '.brl';
}

/**
 * Derive the Blaze artifact kind from its name prefix and file content.
 * Based on glosario section 2 (Name Prefixes — Convention).
 *
 *   rs   → ruleset        (orquestador, not individually verifiable)
 *   fcn  → function
 *   dt   → decision_table
 *   rst  → group_template
 *   grp  → group_template
 *   ct   → group_template (Code Template inside Group Template)
 *   rt   → group_template (Rule Template inside Group Template)
 *   rule → rule           (individual rule inside a ruleset)
 */
function deriveKind(name: string, content: string): RuleEntry['kind'] {
  if (/^rs[A-Z]/.test(name))  return 'ruleset';
  if (/^fcn[A-Z]/.test(name)) return 'function';
  if (/^dt[A-Z]/.test(name))  return 'decision_table';
  if (/^(rst|grp|ct|rt)[A-Z]/.test(name)) return 'group_template';
  if (/^rule[A-Z]/.test(name)) return 'rule';
  // Fallback: detect from XML content
  if (content.includes('<srl:function>') || content.includes('<srl:function ')) return 'function';
  if (content.includes('<srl:ruleset-body>')) return 'ruleset';
  return 'unknown';
}

/**
 * Extract the CDATA body for a specific rule/function name from file content.
 * Blaze stores rule bodies as: <srl:body><![CDATA[...]]></srl:body>
 * We look for the block closest to the <srl:name>ruleName</srl:name> tag.
 */
function extractCdataBody(ruleName: string, content: string): string {
  // Find the <srl:name>ruleName</srl:name> position
  const nameTag = `<srl:name>${ruleName}</srl:name>`;
  const nameIdx = content.indexOf(nameTag);
  if (nameIdx === -1) {
    // Fallback: look for name= attribute
    const attrIdx = content.indexOf(`name="${ruleName}"`);
    if (attrIdx === -1) return extractFirstCdata(content);
    return extractNextCdata(content, attrIdx);
  }
  return extractNextCdata(content, nameIdx);
}

/**
 * Extract the next <srl:body> CDATA block after a given position.
 */
function extractNextCdata(content: string, fromIdx: number): string {
  // Find <srl:body> after fromIdx
  const bodyStart = content.indexOf('<srl:body>', fromIdx);
  if (bodyStart === -1) return '';
  const bodyEnd = content.indexOf('</srl:body>', bodyStart);
  if (bodyEnd === -1) return '';

  const bodyContent = content.slice(bodyStart + 10, bodyEnd);

  // Extract CDATA content if present
  const cdataMatch = bodyContent.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdataMatch) {
    return cdataMatch[1].trim().slice(0, 4000);
  }

  // No CDATA — strip any XML tags and return plain text
  return bodyContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
}

/**
 * Extract the first CDATA block found in the content (fallback).
 */
function extractFirstCdata(content: string): string {
  const cdataMatch = content.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdataMatch) return cdataMatch[1].trim().slice(0, 4000);
  return content.slice(0, 4000);
}

/**
 * Parse a single rule file and return all rule entries found in it.
 * Uses glosario knowledge to correctly identify and categorize Blaze artifacts.
 */
function parseRuleFile(filePath: string, repoRoot: string): RuleEntry[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    try {
      content = fs.readFileSync(filePath, 'latin1');
    } catch {
      return [];
    }
  }

  // Only parse files that look like Blaze SRL/XML
  if (!content.includes('<')) return [];

  const relPath = path.relative(repoRoot, filePath);
  const results: RuleEntry[] = [];
  const seen = new Set<string>();
  const fileName = path.basename(filePath);

  // ── Strategy 1: Extract <srl:name> inside <srl:rule> or <srl:function> blocks ──
  const SRL_BLOCK_PATTERN = /<srl:(rule|function)\b[^>]*>([\s\S]*?)<\/srl:\1>/g;
  let match: RegExpExecArray | null;

  SRL_BLOCK_PATTERN.lastIndex = 0;
  while ((match = SRL_BLOCK_PATTERN.exec(content)) !== null) {
    const tagKind = match[1] as 'rule' | 'function';
    const block = match[2];

    const nameMatch = /<srl:name>([^<]+)<\/srl:name>/.exec(block);
    if (!nameMatch) continue;
    const ruleName = nameMatch[1].trim();
    if (!ruleName || seen.has(ruleName) || !looksLikeRuleName(ruleName)) continue;
    seen.add(ruleName);

    const cdataMatch = block.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    const body = cdataMatch
      ? cdataMatch[1].trim().slice(0, 4000)
      : block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);

    results.push({
      name:    ruleName,
      source:  relPath,
      section: deriveSectionFromPath(relPath),
      rowData: [ruleName, relPath],
      body,
      kind:    tagKind === 'function' ? 'function' : 'rule',
    });
  }

  // ── Strategy 1b: Extract <rule><name>ruleName</name><body>...</body></rule> ──
  // Blaze rulesets use this pattern WITHOUT the srl: namespace
  // e.g. rsCalculateLegBaseCredits has <rule managementPropertiesRef='...'><name>ruleLimoSameStation</name><body>...</body></rule>
  const RULE_BLOCK_PATTERN = /<rule\b[^>]*>([\s\S]*?)<\/rule>/g;
  RULE_BLOCK_PATTERN.lastIndex = 0;
  while ((match = RULE_BLOCK_PATTERN.exec(content)) !== null) {
    const block = match[1];
    const nameMatch = /<name>([^<]+)<\/name>/.exec(block);
    if (!nameMatch) continue;
    const ruleName = nameMatch[1].trim();
    if (!ruleName || seen.has(ruleName) || !looksLikeRuleName(ruleName)) continue;
    seen.add(ruleName);

    // Extract body — may contain CDATA mixed with template:br tags
    const bodyEl = /<body>([\s\S]*?)<\/body>/.exec(block);
    const rawBody = bodyEl ? bodyEl[1] : block;
    // Extract all CDATA sections and join them
    const cdataChunks = [...rawBody.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map(m => m[1]);
    const body = cdataChunks.length > 0
      ? cdataChunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, 4000)
      : rawBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);

    results.push({
      name:    ruleName,
      source:  relPath,
      section: deriveSectionFromPath(relPath),
      rowData: [ruleName, relPath],
      body,
      kind:    'rule',
    });
  }

  // ── Strategy 2: file-level artifact (ruleset, function file, decision table) ──
  // If no individual rules found yet, index the file itself by its name
  // This captures rsXxx, fcnXxx, dtXxx files as single entries
  if (results.length === 0) {
    // Check for <template name="artifactName"> pattern
    const tplMatch = content.match(/<template\b[^>]*\bname=['"]([^'"]+)['"]/);
    if (tplMatch) {
      const artifactName = tplMatch[1].trim();
      if (artifactName && looksLikeRuleName(artifactName) && !seen.has(artifactName)) {
        seen.add(artifactName);
        const body = extractFirstCdata(content);
        results.push({
          name:    artifactName,
          source:  relPath,
          section: deriveSectionFromPath(relPath),
          rowData: [artifactName, relPath],
          body,
          kind:    deriveKind(artifactName, content),
        });
      }
    }
  }

  // ── Strategy 3: filename as artifact name (common in Blaze — file name = artifact name) ──
  if (results.length === 0 && looksLikeRuleName(fileName)) {
    const body = extractFirstCdata(content);
    if (body || content.includes('<srl:')) {
      results.push({
        name:    fileName,
        source:  relPath,
        section: deriveSectionFromPath(relPath),
        rowData: [fileName, relPath],
        body,
        kind:    deriveKind(fileName, content),
      });
    }
  }

  // ── Strategy 4: legacy regex fallback for non-standard files ──
  if (results.length === 0) {
    const LEGACY_PATTERNS = [
      /<(rule|function|template|ruleflow|decision-table)\b[^>]*\bname\s*=\s*['"]([^'"]+)['"]/g,
      /\bname\s*=\s*['"]([^'"]+)['"]/g,
    ];
    for (const pattern of LEGACY_PATTERNS) {
      pattern.lastIndex = 0;
      while ((match = pattern.exec(content)) !== null) {
        const ruleName = match[match.length - 1]; // last capture group = name
        if (ruleName && !seen.has(ruleName) && looksLikeRuleName(ruleName)) {
          seen.add(ruleName);
          results.push(buildEntry(ruleName, relPath, content));
        }
      }
      if (results.length > 0) break;
    }
  }

  return results;
}

/**
 * Return true if the name looks like a Blaze rule / function name.
 * Based on glosario section 2 prefixes.
 */
function looksLikeRuleName(name: string): boolean {
  if (name.length < 3 || name.length > 200) return false;
  return /^(rule[A-Z]|fcn[A-Z]|rs[A-Z]|rst[A-Z]|dt[A-Z]|ct[A-Z]|rt[A-Z]|grp[A-Z])/.test(name) ||
    /^[A-Z]_[A-Za-z]+_\d{3,}$/.test(name); // rule IDs like F_RestAmt_001
}

/**
 * Build a RuleEntry from name + file content (legacy fallback).
 */
function buildEntry(name: string, relPath: string, content: string): RuleEntry {
  return {
    name,
    source:  relPath,
    section: deriveSectionFromPath(relPath),
    rowData: [name, relPath],
    body:    extractCdataBody(name, content),
    kind:    deriveKind(name, content),
  };
}

/**
 * Extract config keys from rule body content.
 */
export function extractConfigKeys(content: string): string[] {
  const keys = new Set<string>();
  let match: RegExpExecArray | null;
  CONFIG_KEY_PATTERN.lastIndex = 0;
  while ((match = CONFIG_KEY_PATTERN.exec(content)) !== null) {
    keys.add(match[1]);
  }
  return Array.from(keys);
}

/**
 * Extract hardcoded date literals from rule body content.
 */
export function extractHardcodedDates(content: string): string[] {
  const dates = new Set<string>();
  let match: RegExpExecArray | null;
  DATE_PATTERN.lastIndex = 0;
  while ((match = DATE_PATTERN.exec(content)) !== null) {
    dates.add(match[1]);
  }
  return Array.from(dates);
}

/**
 * Derive a section name from the relative file path.
 * e.g. "TechnicalLibrary/Rest/rsCalcRest" → "Rest"
 */
function deriveSectionFromPath(relPath: string): string {
  const parts = relPath.split(path.sep).filter(Boolean);
  // Skip TechnicalLibrary / BusinessLibrary root
  if (parts.length >= 3) return parts[1];
  if (parts.length === 2) return parts[0];
  return '';
}

/**
 * Find a file with the given name within maxDepth levels of root.
 */
function findFileRecursive(root: string, fileName: string, maxDepth: number): boolean {
  if (maxDepth < 0) return false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === fileName) return true;
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      if (findFileRecursive(path.join(root, entry.name), fileName, maxDepth - 1)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Count extension-less files in the repo (approximate rule file count).
 * Limits scan to 5000 files to avoid hanging on huge repos.
 */
function countRuleFiles(repoPath: string): number {
  let count = 0;
  const limit = 5000;

  function walk(dir: string, depth: number): void {
    if (count >= limit || depth > 8) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= limit) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && isRuleFile(entry.name)) {
        count++;
      }
    }
  }

  walk(repoPath, 0);
  return count;
}
