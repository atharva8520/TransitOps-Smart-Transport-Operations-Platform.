export class RulesEngine {
  constructor(db) {
    this.db = db;
  }

  async evaluateTransition(transitionType, data) {
    console.log(`Evaluating transition: ${transitionType} with data:`, data);
    return { allowed: true };
  }
}
