import {
  SalesInvoiceReceivable,
  SalesInvoiceReceivableSchema,
  SalesPaymentAmountSchema,
} from "@liass-ohada/shared/sales";
import { AppError } from "@/lambda/shared/app-error";
import { SalesInvoiceCalculator } from "./sales-invoice-calculator";

const normalizeMoney = (currency: string, value: string): string =>
  SalesInvoiceCalculator.fromMinorUnits(
    currency,
    SalesInvoiceCalculator.toMinorUnits(currency, value),
  );

export class SalesReceivableCalculator {
  static synthetic(input: {
    invoiceId: string;
    currency: string;
    invoiceAmount: string;
    timestamp: string;
  }): SalesInvoiceReceivable {
    const invoiceAmount = normalizeMoney(input.currency, input.invoiceAmount);
    return SalesInvoiceReceivableSchema.parse({
      invoiceId: input.invoiceId,
      currency: input.currency,
      invoiceAmount,
      amountPaid: "0",
      balanceDue: invoiceAmount,
      status: invoiceAmount === "0" ? "PAID" : "UNPAID",
      paymentCount: 0,
      version: 0,
      updatedAt: input.timestamp,
    });
  }

  static applyPayment(
    current: SalesInvoiceReceivable,
    paymentAmount: string,
    timestamp: string,
  ): { amount: string; receivable: SalesInvoiceReceivable } {
    SalesPaymentAmountSchema.parse(paymentAmount);
    let amountMinor: bigint;
    try {
      amountMinor = BigInt(
        SalesInvoiceCalculator.toMinorUnits(current.currency, paymentAmount),
      );
    } catch {
      throw new AppError(400, "SALES_PAYMENT_PRECISION_INVALID");
    }
    const balanceMinor = BigInt(
      SalesInvoiceCalculator.toMinorUnits(current.currency, current.balanceDue),
    );
    if (amountMinor > balanceMinor) {
      throw new AppError(409, "SALES_PAYMENT_EXCEEDS_BALANCE");
    }
    const paidMinor = BigInt(
      SalesInvoiceCalculator.toMinorUnits(current.currency, current.amountPaid),
    ) + amountMinor;
    const invoiceMinor = BigInt(
      SalesInvoiceCalculator.toMinorUnits(current.currency, current.invoiceAmount),
    );
    const nextBalanceMinor = invoiceMinor - paidMinor;
    const amountPaid = SalesInvoiceCalculator.fromMinorUnits(
      current.currency,
      paidMinor.toString(),
    );
    const balanceDue = SalesInvoiceCalculator.fromMinorUnits(
      current.currency,
      nextBalanceMinor.toString(),
    );
    const amount = SalesInvoiceCalculator.fromMinorUnits(
      current.currency,
      amountMinor.toString(),
    );
    return {
      amount,
      receivable: SalesInvoiceReceivableSchema.parse({
        ...current,
        amountPaid,
        balanceDue,
        status: nextBalanceMinor === 0n ? "PAID" : "PARTIALLY_PAID",
        paymentCount: current.paymentCount + 1,
        version: current.version + 1,
        createdAt: current.createdAt ?? timestamp,
        updatedAt: timestamp,
      }),
    };
  }
}
