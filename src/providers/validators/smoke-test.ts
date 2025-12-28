/**
 * Smoke Test Validator
 * 
 * Makes HTTP requests to configured URLs and validates that they don't return
 * 500 errors or contain PHP error messages. This catches runtime errors that
 * syntax checking cannot detect.
 */

export interface SmokeTestConfig {
  baseUrl: string;
  urls: string[];
  timeout?: number;
  authCommand?: string; // Command to get auth cookie (e.g., "ddev exec drush uli")
}

export interface SmokeTestResult {
  success: boolean;
  errors: string[];
  results: UrlTestResult[];
}

export interface UrlTestResult {
  url: string;
  status: number;
  success: boolean;
  error?: string;
  responsePreview?: string;
}

export class SmokeTestValidator {
  private debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
  }

  /**
   * Validates all configured URLs by making HTTP requests.
   */
  async validate(config: SmokeTestConfig): Promise<SmokeTestResult> {
    const results: UrlTestResult[] = [];
    const errors: string[] = [];
    const timeout = config.timeout || 10000;

    if (this.debug) {
      console.log(`[SmokeTest] Validating ${config.urls.length} URLs against ${config.baseUrl}`);
    }

    // Get auth cookie if configured
    let authCookie: string | undefined;
    if (config.authCommand) {
      try {
        authCookie = await this.getAuthCookie(config.authCommand, config.baseUrl);
        if (this.debug) {
          console.log('[SmokeTest] Got authentication cookie');
        }
      } catch (e: any) {
        console.warn(`[SmokeTest] Failed to get auth cookie: ${e.message}`);
      }
    }

    for (const urlPath of config.urls) {
      const fullUrl = `${config.baseUrl}${urlPath}`;
      const result = await this.testUrl(fullUrl, timeout, authCookie);
      results.push(result);

      if (!result.success) {
        errors.push(`${urlPath}: ${result.error || `HTTP ${result.status}`}`);
      }

      if (this.debug) {
        const status = result.success ? '✓' : '✗';
        console.log(`[SmokeTest] ${status} ${urlPath} (${result.status})`);
      }
    }

    return {
      success: errors.length === 0,
      errors,
      results,
    };
  }

  /**
   * Tests a single URL for errors.
   */
  private async testUrl(url: string, timeout: number, authCookie?: string): Promise<UrlTestResult> {
    try {
      const headers: Record<string, string> = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'DevLoop-SmokeTest/1.0',
      };

      if (authCookie) {
        headers['Cookie'] = authCookie;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const status = response.status;
      const text = await response.text();
      const responsePreview = text.substring(0, 500);

      // Check for 5xx errors
      if (status >= 500) {
        return {
          url,
          status,
          success: false,
          error: `Server error: HTTP ${status}`,
          responsePreview,
        };
      }

      // Check for PHP errors in response body
      const phpErrors = this.detectPhpErrors(text);
      if (phpErrors.length > 0) {
        return {
          url,
          status,
          success: false,
          error: `PHP errors detected: ${phpErrors.join('; ')}`,
          responsePreview,
        };
      }

      // 4xx errors might be expected (access denied, etc.) - log but don't fail
      if (status >= 400) {
        if (this.debug) {
          console.log(`[SmokeTest] Warning: ${url} returned ${status} (may be expected)`);
        }
      }

      return {
        url,
        status,
        success: true,
      };
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return {
          url,
          status: 0,
          success: false,
          error: `Request timeout after ${timeout}ms`,
        };
      }

      return {
        url,
        status: 0,
        success: false,
        error: e.message,
      };
    }
  }

  /**
   * Detects common PHP error patterns in response text.
   */
  private detectPhpErrors(text: string): string[] {
    const errors: string[] = [];
    const patterns = [
      /Fatal error:.*?(?:\n|<br|$)/i,
      /Parse error:.*?(?:\n|<br|$)/i,
      /Uncaught.*?Exception.*?(?:\n|<br|$)/i,
      /Call to undefined method.*?(?:\n|<br|$)/i,
      /Call to undefined function.*?(?:\n|<br|$)/i,
      /TypeError:.*?must be of type.*?(?:\n|<br|$)/i,
      /ArgumentCountError:.*?(?:\n|<br|$)/i,
      /Error:.*?in.*?\.php.*?line \d+/i,
      /The website encountered an unexpected error/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        // Clean up the error message
        const error = match[0]
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]+>/g, '')
          .trim()
          .substring(0, 200);
        errors.push(error);
      }
    }

    return errors;
  }

  /**
   * Gets an authentication cookie by running a command (e.g., drush uli).
   */
  private async getAuthCookie(command: string, baseUrl: string): Promise<string | undefined> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      // Execute the auth command to get a one-time login URL
      const { stdout } = await execAsync(command, { timeout: 30000 });
      const loginUrl = stdout.trim();

      if (!loginUrl || !loginUrl.includes('user/reset')) {
        return undefined;
      }

      // Make a request to the login URL to get session cookies
      const response = await fetch(loginUrl, {
        method: 'GET',
        redirect: 'manual', // Don't follow redirects
      });

      // Extract Set-Cookie headers
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        // Parse the session cookie
        const match = setCookie.match(/SESS[^=]*=[^;]+/);
        if (match) {
          return match[0];
        }
      }

      return undefined;
    } catch (e) {
      return undefined;
    }
  }
}

export default SmokeTestValidator;
