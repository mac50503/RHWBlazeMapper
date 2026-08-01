/**
 * repo.ts — Express routes for repo validation and discovery.
 *
 * Route prefix: /api/repo  (mounted in index.ts)
 *
 * Routes implemented:
 *   POST /validate     — validate a local path is a Blaze repo
 *   GET  /suggest      — suggest Blaze repos found on the local filesystem
 *   GET  /repo_info    — return workbook-to-repo mapping info
 *   POST /clear_cache  — clear the repo scan cache
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { validateRepo } from '../services/blazeIndexer';
import { SuggestReposResponse } from '../types';

export const repoRouter = Router();

// ---------------------------------------------------------------------------
// Blaze repo detection helpers
// ---------------------------------------------------------------------------

const BLAZE_MARKERS = ['TechnicalLibrary', 'BusinessLibrary', '.innovator_attbs'];
const REPO_NAME_HINTS = ['CrewRulesRepository', 'blaze', 'rules-service', 'rules-repository'];

/** Return true if a folder looks like a Blaze repo (quick scan, no recursion). */
function quickDetectBlaze(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir);
    return BLAZE_MARKERS.some((marker) =>
      entries.includes(marker) ||
      entries.some((e) => {
        try {
          return fs.readdirSync(path.join(dir, e)).includes(marker);
        } catch {
          return false;
        }
      })
    );
  } catch {
    return false;
  }
}

/** Return true if the folder name hints that it's a rules repo. */
function nameHintsBlaze(dirName: string): boolean {
  const lower = dirName.toLowerCase();
  return REPO_NAME_HINTS.some((h) => lower.includes(h.toLowerCase()));
}

// ---------------------------------------------------------------------------
// POST /validate
// ---------------------------------------------------------------------------

repoRouter.post('/validate', (req: Request, res: Response) => {
  const { repoPath } = req.body as { repoPath: string };

  if (!repoPath) {
    res.status(400).json({ error: 'repoPath is required' });
    return;
  }

  const result = validateRepo(repoPath);

  res.json({
    valid:      result.valid,
    engine:     result.engine,
    rule_files: result.rule_files,
    message:    result.message,
  });
});

// ---------------------------------------------------------------------------
// GET /suggest
// ---------------------------------------------------------------------------

/**
 * Scan common local directories for Blaze repos.
 * On Windows: ~/Documents, ~/source, ~/repos, ~/dev, C:/repos, C:/dev
 * On Mac/Linux: ~/Documents, ~/Code, ~/projects, ~/dev, ~/repos, ~/src
 */
repoRouter.get('/suggest', (_req: Request, res: Response) => {
  const home = os.homedir();
  const isWin = process.platform === 'win32';

  const scanRoots: string[] = isWin
    ? [
        path.join(home, 'Documents'),
        path.join(home, 'source'),
        path.join(home, 'repos'),
        path.join(home, 'dev'),
        'C:\\repos',
        'C:\\dev',
      ]
    : [
        path.join(home, 'Documents'),
        path.join(home, 'Code'),
        path.join(home, 'projects'),
        path.join(home, 'dev'),
        path.join(home, 'repos'),
        path.join(home, 'src'),
      ];

  const found: string[] = [];
  const MAX_RESULTS = 20;

  for (const root of scanRoots) {
    if (!fs.existsSync(root)) continue;
    searchForRepos(root, found, MAX_RESULTS, 3);
    if (found.length >= MAX_RESULTS) break;
  }

  const response: SuggestReposResponse = {
    source: 'local',
    filter: null,
    paths: found,
  };

  res.json(response);
});

// ---------------------------------------------------------------------------
// GET /repo_info
// ---------------------------------------------------------------------------

/**
 * Returns workbook-to-repo mapping info.
 * This is a static mapping based on workbook filename patterns.
 */
repoRouter.get('/repo_info', (req: Request, res: Response) => {
  const excel = req.query['excel'] as string | undefined;

  if (!excel) {
    res.status(400).json({ error: '"excel" query param is required' });
    return;
  }

  const lower = path.basename(excel).toLowerCase();

  let projectPath = '';
  let description = '';

  if (lower.includes('_fo_') || lower.startsWith('swa_fo') || lower.startsWith('swa fo')) {
    if (lower.includes('vacancy')) {
      projectPath = 'csr/services/crew-java-app-blaze-ror-fo-vacancy-service';
      description = 'ROR FO Vacancy Rules Service';
    } else {
      projectPath = 'csr/services/crew-java-app-blaze-css-fo-rules-service';
      description = 'CSS FO Rules Service';
    }
  } else if (lower.includes('if ') || lower.startsWith('if_') || lower.includes('_if_')) {
    projectPath = 'csr/services/crew-java-app-blaze-css-if-rules-service';
    description = 'CSS IF Rules Service';
  } else {
    projectPath = 'csr/services/crew-java-app-blaze-css-if-rules-service';
    description = 'CSS IF Rules Service (default)';
  }

  res.json({
    project_path: projectPath,
    gitlab_url:   `https://southwest.gitlab-dedicated.com/${projectPath}`,
    description,
    // Branch list is static — real implementation would call GitLab API
    branches: [
      { name: 'master', last_commit: new Date().toISOString(), is_default: true },
    ],
  });
});

// ---------------------------------------------------------------------------
// Filesystem search helper
// ---------------------------------------------------------------------------

function searchForRepos(
  dir: string,
  results: string[],
  maxResults: number,
  maxDepth: number
): void {
  if (results.length >= maxResults || maxDepth < 0) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) break;
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const fullPath = path.join(dir, entry.name);

    // If this folder looks like a rules repo, add it
    if (nameHintsBlaze(entry.name) || quickDetectBlaze(fullPath)) {
      results.push(fullPath);
    } else {
      // Recurse
      searchForRepos(fullPath, results, maxResults, maxDepth - 1);
    }
  }
}
