import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Kiro CLI runner — Windows only
 *
 * Executes kiro-cli in headless mode with:
 * - KIRO_SKIP_UPDATE_CHECK=1   → prevents auto-update check
 * - KIRO_NO_AUTO_UPDATE=1      → prevents MSI elevation prompt
 * - KIRO_TELEMETRY_DISABLED=1  → disables telemetry
 */

export interface KiroResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Find the kiro-cli binary.
 */
function findKiroBinary(): string | null {
  const candidates = ['kiro-cli', 'kiro-cli.exe', 'kiro'];
  for (const candidate of candidates) {
    try {
      require('child_process').execSync(`${candidate} --version`, {
        stdio: 'pipe',
        timeout: 5000,
      });
      return candidate;
    } catch {
      // not found, try next
    }
  }
  return null;
}

/**
 * Build environment variables for Kiro subprocess.
 */
function buildKiroEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONUTF8: '1',
    KIRO_SKIP_UPDATE_CHECK: '1',
    KIRO_NO_AUTO_UPDATE: '1',
    KIRO_TELEMETRY_DISABLED: '1',
  };
}

/**
 * Run a Kiro prompt and return the response.
 *
 * @param prompt   Full prompt text to send to Kiro
 * @param model    Kiro model (default: claude-haiku-4.5)
 * @param timeout  Timeout in milliseconds (default: 120000 = 2 min)
 */
export async function runKiro(
  prompt: string,
  model = 'claude-haiku-4.5',
  timeout = 120_000
): Promise<KiroResult> {
  const kiroBin = findKiroBinary();
  if (!kiroBin) {
    return {
      success: false,
      output: '',
      error: 'Kiro CLI not found. Install from: https://kiro.dev',
    };
  }

  // Write prompt to temp file and pass as @file argument
  // Passing large prompts as direct CLI args can be truncated on Windows
  const promptFile = join(tmpdir(), `rhw_blaze_mapper_${Date.now()}.txt`);
  writeFileSync(promptFile, prompt, 'utf8');

  const promptArg = `@${promptFile.replace(/\\/g, '/')}`;

  const args = [
    'chat',
    '--no-interactive',
    '--trust-all-tools',
    '--model', model,
    promptArg,
  ];

  return new Promise((resolve) => {
    const proc = spawn(kiroBin, args, {
      env: buildKiroEnv(),
      shell: false, // shell=false avoids cmd.exe issues on Windows
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

    const timer = setTimeout(() => {
      proc.kill();
      cleanup();
      resolve({
        success: false,
        output: stdout,
        error: `Kiro timed out after ${timeout / 1000}s`,
      });
    }, timeout);

    const cleanup = () => {
      try { unlinkSync(promptFile); } catch { /* ignore */ }
    };

    proc.on('close', (code) => {
      clearTimeout(timer);
      cleanup();

      // Strip ANSI escape codes from output
      const raw = stdout || stderr;
      const clean = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();

      resolve({
        success: code === 0,
        output: clean,
        error: code !== 0 ? `Kiro exited with code ${code}` : undefined,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      resolve({
        success: false,
        output: '',
        error: `Failed to start Kiro: ${err.message}`,
      });
    });
  });
}
