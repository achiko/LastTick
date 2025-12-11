/**
 * Utility helper functions
 */

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const delay = baseDelay * Math.pow(2, attempt);
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Format a number as USD currency
 */
export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/**
 * Format a percentage
 */
export function formatPercent(value: number, decimals: number = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Calculate profit from buying at a price and selling at $1
 */
export function calculateProfit(buyPrice: number, shares: number): number {
  const cost = buyPrice * shares;
  const payout = shares; // $1 per share if winner
  return payout - cost;
}

/**
 * Calculate ROI percentage
 */
export function calculateROI(profit: number, cost: number): number {
  if (cost === 0) return 0;
  return (profit / cost) * 100;
}

/**
 * Truncate a string to a maximum length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Check if a date is within a certain number of hours from now
 */
export function isWithinHours(date: Date | string, hours: number): boolean {
  const targetDate = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours > 0 && diffHours <= hours;
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle a function
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
