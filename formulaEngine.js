// server/formulaEngine.js (Final Calculation Logic with Flagging)

const getSeasonalBenefitRate = (tourDate) => {
  const month = tourDate.getMonth() + 1;

  // Assuming tourDate is a Date object
  if (month >= 5 && month <= 12) {
    return { rate: 0.125, name: "Xmas" }; // 12.5%
  } else {
    return { rate: 0.1538, name: "Easter" }; // 15.38%
  }
};

const round = (num) => Math.round(num * 100) / 100;

// --- SCENARIO 1 LOGIC (Now used for Scenario 3 as well) ---
const calculateScenario1 = (basePrice, date) => {
  const seasonalBenefit = getSeasonalBenefitRate(date);
  const paidLeaveRate = 0.08;
  const indemnizationRate = 0.08;
  const ikaRate = 0.1337;
  const taxRate = 0.05;

  const seasonalBenefitAmount = basePrice * seasonalBenefit.rate;
  const paidLeaveBenefit = basePrice * paidLeaveRate;
  const leaveIndemnization = basePrice * indemnizationRate;

  const grossAmount = basePrice + seasonalBenefitAmount + paidLeaveBenefit;
  const ika = grossAmount * ikaRate;

  const taxOnGross = (grossAmount - ika) * taxRate;
  const taxOnIndemnization = leaveIndemnization * taxRate;
  const totalTax = taxOnGross + taxOnIndemnization;

  const netPayment =
    basePrice +
    (seasonalBenefitAmount + paidLeaveBenefit + leaveIndemnization) -
    (ika + totalTax);

  return {
    basePrice: round(basePrice),
    netPayment: round(netPayment),
    seasonalBenefit: round(seasonalBenefitAmount),
    paidLeaveBenefit: round(paidLeaveBenefit),
    leaveIndemnization: round(leaveIndemnization),
    grossAmount: round(grossAmount),
    ika: round(ika),
    totalTax: round(totalTax),
    // All other financial data needed for reporting is included here
  };
};

// --- SCENARIO 2 LOGIC ---
const calculateScenario2 = (basePrice, date) => {
  const seasonalBenefit = getSeasonalBenefitRate(date);
  const paidLeaveRate = 0.08;
  const indemnizationRate = 0.08;
  const ikaRate = 0.1337;
  const taxRate = 0.05;

  const seasonalBenefitAmount = basePrice * seasonalBenefit.rate;
  const paidLeaveBenefit = basePrice * paidLeaveRate;
  const leaveIndemnization = basePrice * indemnizationRate;

  const grossAmount =
    basePrice + seasonalBenefitAmount + paidLeaveBenefit + leaveIndemnization;
  const ikaTaxableBase = grossAmount - leaveIndemnization;
  const ika = ikaTaxableBase * ikaRate;

  const taxOnGross = (grossAmount - ika) * taxRate;
  const totalTax = taxOnGross;

  const netPayment = grossAmount - (ika + totalTax);

  return {
    basePrice: round(basePrice),
    netPayment: round(netPayment),
    seasonalBenefit: round(seasonalBenefitAmount),
    paidLeaveBenefit: round(paidLeaveBenefit),
    leaveIndemnization: round(leaveIndemnization),
    grossAmount: round(grossAmount),
    ika: round(ika),
    totalTax: round(totalTax),
    // All other financial data needed for reporting is included here
  };
};

/**
 * Calculates the tour guide's net earnings based on the base price and scenario.
 * @param {number} basePrice - The raw price of the tour.
 * @param {string} tourDate - The date of the tour (YYYY-MM-DD).
 * @param {number} scenario - The agency's calculation scenario (1, 2, or 3).
 * @returns {object} The calculation results plus the final calculated_net_payment and is_taxed flag.
 */
const calculateTourEarnings = (basePrice, tourDate, scenario) => {
  const date = new Date(tourDate);
  let calculationResult;
  let is_taxed = true;

  if (scenario === 1) {
    calculationResult = calculateScenario1(basePrice, date);
    is_taxed = true; // Taxed
  } else if (scenario === 2) {
    calculationResult = calculateScenario2(basePrice, date);
    is_taxed = true; // Taxed
  } else if (scenario === 3) {
    // SCENARIO 3: Identical calculation to Scenario 1
    calculationResult = calculateScenario1(basePrice, date);
    is_taxed = false; // 👈 CRITICAL FLAG: NOT Taxed
  } else {
    // Default error handling
    return {
      netPayment: round(basePrice),
      is_taxed: false,
      error: "Unknown calculation scenario specified.",
    };
  }

  // Ensure net payment is rounded correctly before storage
  const finalNetPayment = calculationResult.netPayment;

  // Return the necessary data for the database insertion
  return {
    netPayment: finalNetPayment, // The final, calculated net amount
    is_taxed: is_taxed, // The flag we need for reporting
    details: calculationResult, // All detailed calculations (gross, IKA, tax, etc.)
  };
};

module.exports = { calculateTourEarnings };
