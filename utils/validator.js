// Anomaly Alert Threshold Validator
export function validateThreshold(score, threshold = 0.85) {
  if (typeof score !== 'number' || isNaN(score)) {
    throw new TypeError('Anomaly score must be a valid number');
  }
  return score >= threshold;
}
