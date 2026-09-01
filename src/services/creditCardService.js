/**
 * Service to calculate invoice months, generate installments, and calculate best card for purchase date.
 */
class CreditCardService {
  /**
   * Calculates the invoice reference month (YYYY-MM) given a purchase date, card closing day, and installment offset.
   * 
   * Rule:
   * - If purchase date's day of month is >= closing day, it belongs to the next month's invoice.
   * - Then add the installment offset (0 for 1st installment, 1 for 2nd, etc.)
   */
  static getInvoiceMonth(purchaseDate, closingDay, installmentOffset = 0) {
    const date = new Date(purchaseDate);
    const day = date.getDate();
    let month = date.getMonth(); // 0-11
    let year = date.getFullYear();

    if (day >= closingDay) {
      month += 1;
    }

    month += installmentOffset;

    const targetDate = new Date(year, month, 1);
    const yyyy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');

    return `${yyyy}-${mm}`;
  }

  /**
   * Calculates days until payment due date for today.
   */
  static getDaysUntilDue(card, today = new Date()) {
    const day = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    let dueMonth = currentMonth;
    const closingDay = card.diaFechamento || card.dia_fechamento || 1;
    const dueDay = card.diaVencimento || card.dia_vencimento || 10;

    if (day >= closingDay) {
      dueMonth += 1;
    }

    if (dueDay < closingDay) {
      dueMonth += 1;
    }

    const dueDate = new Date(currentYear, dueMonth, dueDay);
    const diffMs = dueDate.getTime() - today.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  /**
   * Finds the best card among a user's cards to buy today (card that gives the longest term until invoice due date).
   */
  static findBestCardToBuy(cards, today = new Date()) {
    if (!cards || cards.length === 0) return null;

    let best = null;
    let maxDays = -1;

    for (const card of cards) {
      const days = this.getDaysUntilDue(card, today);
      if (days > maxDays) {
        maxDays = days;
        best = {
          cartao: card,
          dias_ate_vencimento: days,
          dia_fechamento: card.diaFechamento || card.dia_fechamento,
          dia_vencimento: card.diaVencimento || card.dia_vencimento
        };
      }
    }

    return best;
  }
}

module.exports = CreditCardService;
