import { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Copy, FileText, X } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';

interface Order {
  id: string;
  order_id: string;
  order_type: 'ecom' | 'instant' | 'errand';
  voucher_no?: string;
  address: string;
  notes?: string;
  order_amount_usd: number;
  order_amount_lbp: number;
  delivery_fee_usd: number;
  delivery_fee_lbp: number;
  amount_due_to_client_usd?: number;
  driver_paid_for_client?: boolean;
  created_at: string;
  customers?: { phone: string; name?: string; address?: string };
}

interface ClientStatementPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: Order[];
  clientName: string;
  dateFrom: string;
  dateTo: string;
  issueStatementMutation: any;
  totals: {
    totalOrders: number;
    totalOrderAmountUsd: number;
    totalOrderAmountLbp: number;
    totalDeliveryFeesUsd: number;
    totalDeliveryFeesLbp: number;
    totalDueToClientUsd: number;
    totalDueToClientLbp: number;
  };
}

export function ClientStatementPreview({
  open,
  onOpenChange,
  orders,
  clientName,
  dateFrom,
  dateTo,
  issueStatementMutation,
  totals,
}: ClientStatementPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);

  // Filter out orders with zero order amounts - statements are only for paid/collected amounts
  const filteredOrders = orders;
  // const filteredOrders = orders.filter(o => {
  //   const hasOrderAmount = Number(o.order_amount_usd || 0) > 0 || Number(o.order_amount_lbp || 0) > 0;
  //   return hasOrderAmount;
  // });

  const instantOrders = filteredOrders.filter(o => o.order_type === 'instant' || o.order_type === 'errand');
  const ecomOrders = filteredOrders.filter(o => o.order_type === 'ecom');

  const calculateDue = (order: Order) => {
    if (order.order_type === 'instant' || order.order_type === 'errand') {
      if (order.driver_paid_for_client) {
        return {
          usd: -1 * (Number(order.order_amount_usd || 0) + Number(order.delivery_fee_usd || 0)),
          lbp: -1 * (Number(order.order_amount_lbp || 0) + Number(order.delivery_fee_lbp || 0)),
        };
      }
      return {
        usd: Number(order.order_amount_usd || 0),
        lbp: Number(order.order_amount_lbp || 0),
      };
    }
    return {
      usd: Number(order.amount_due_to_client_usd || 0),
      lbp: 0,
    };
  };

  const formatAmount = (usd: number, lbp: number) => {
    const parts = [];
    parts.push(`$${usd.toFixed(2)}`);
    parts.push(`${lbp.toLocaleString()} LL`);
    return parts.length > 0 ? parts.join(' / ') : '-';
  };

  const formatDateLabel = (dateString: string) => format(new Date(dateString), 'MMM dd, yyyy');
  const statementPeriodLabel = `${formatDateLabel(dateFrom)} - ${formatDateLabel(dateTo)}`;

  const exportStatementAsExcel = () => {
    const workbook = XLSX.utils.book_new();
    const rows: Array<Array<string | number>> = [
      ['RUNNERS ERP STATEMENT'],
      ['Client', clientName],
      ['Period', statementPeriodLabel],
      [],
      ['Instant / Errand Orders'],
      ['Date', 'Order ID', 'Address', 'Driver Paid', 'Notes', 'Amount', 'Fee', 'Due'],
    ];

    instantOrders.forEach((order) => {
      const due = calculateDue(order);
      rows.push([
        formatDateLabel(order.created_at),
        order.order_id,
        order.address,
        order.driver_paid_for_client ? 'Yes' : 'No',
        order.notes || '-',
        formatAmount(Number(order.order_amount_usd || 0), Number(order.order_amount_lbp || 0)),
        order.driver_paid_for_client ? formatAmount(Number(order.delivery_fee_usd || 0), Number(order.delivery_fee_lbp || 0)) : '-',
        formatAmount(due.usd, due.lbp),
      ]);
    });

    if (ecomOrders.length > 0) {
      rows.push([], ['E-Commerce Orders'], ['Voucher #', 'Customer', 'Phone', 'Address', 'Order', 'Fee', 'Due']);
      ecomOrders.forEach((order) => {
        const due = calculateDue(order);
        rows.push([
          order.voucher_no || order.order_id,
          order.customers?.name || '-',
          order.customers?.phone || '-',
          order.address,
          `$${Number(order.order_amount_usd + order.delivery_fee_usd).toFixed(2)}`,
          `$${Number(order.delivery_fee_usd).toFixed(2)}`,
          `$${due.usd.toFixed(2)}`,
        ]);
      });
    }

    rows.push([], ['SUMMARY']);
    rows.push(['Total Orders', totals.totalOrders]);
    rows.push(['Order Amount', formatAmount(totals.totalOrderAmountUsd, totals.totalOrderAmountLbp)]);
    rows.push(['Delivery Fees', formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)]);
    rows.push(['Total Due', formatAmount(totals.totalDueToClientUsd, totals.totalDueToClientLbp)]);

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Statement');
    const fileName = `Statement-${clientName.replace(/[^a-zA-Z0-9]/g, '_')}-${format(new Date(), 'yyyyMMdd')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    toast.success('Statement exported as Excel');
  };

  const exportStatementAsPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const lineHeight = 18;
    let y = margin;

    doc.setFillColor('#1d4ed8');
    doc.rect(margin, y, 120, 40, 'F');
    doc.setTextColor('#ffffff');
    doc.setFontSize(14);
    doc.text('RUNNERS', margin + 10, y + 18);
    doc.setFontSize(10);
    doc.text('ERP', margin + 10, y + 34);

    doc.setTextColor('#111827');
    doc.setFontSize(20);
    doc.text('Statement', margin + 150, y + 22);
    doc.setFontSize(10);
    doc.text(`Client: ${clientName}`, margin + 150, y + 40);
    doc.text(`Period: ${statementPeriodLabel}`, margin + 150, y + 56);

    y += 80;

    const addWrappedText = (text: string, indent = 0, options: { bold?: boolean } = {}) => {
      if (y > 760) {
        doc.addPage();
        y = margin;
      }
      if (options.bold) {
        doc.setFont(undefined, 'bold');
      } else {
        doc.setFont(undefined, 'normal');
      }
      const lines = doc.splitTextToSize(text, pageWidth - margin * 2 - indent);
      lines.forEach((line) => {
        doc.text(line, margin + indent, y);
        y += lineHeight;
      });
    };

    const addSectionHeader = (title: string) => {
      if (y > 700) {
        doc.addPage();
        y = margin;
      }
      doc.setFont(undefined, 'bold');
      doc.setFontSize(12);
      doc.text(title, margin, y);
      y += lineHeight;
      doc.setFontSize(10);
    };

    if (instantOrders.length > 0) {
      addSectionHeader(`Instant / Errand Orders (${instantOrders.length})`);
      instantOrders.forEach((order, index) => {
        const due = calculateDue(order);
        addWrappedText(`${index + 1}. ${order.order_id} (${formatDateLabel(order.created_at)})`, 0, { bold: true });
        addWrappedText(`Address: ${order.address}`, 10);
        addWrappedText(`Amount: ${formatAmount(Number(order.order_amount_usd || 0), Number(order.order_amount_lbp || 0))}`, 10);
        if (order.driver_paid_for_client) {
          addWrappedText(`Driver Paid: Yes`, 10);
          addWrappedText(`Fee: ${formatAmount(Number(order.delivery_fee_usd || 0), Number(order.delivery_fee_lbp || 0))}`, 10);
        }
        if (order.notes) {
          addWrappedText(`Notes: ${order.notes}`, 10);
        }
        addWrappedText(`Due: ${formatAmount(due.usd, due.lbp)}`, 10);
        y += 4;
      });
    }

    if (ecomOrders.length > 0) {
      addSectionHeader(`E-Commerce Orders (${ecomOrders.length})`);
      ecomOrders.forEach((order, index) => {
        const due = calculateDue(order);
        addWrappedText(`${index + 1}. ${order.voucher_no || order.order_id}`, 0, { bold: true });
        addWrappedText(`Customer: ${order.customers?.name || '-'}`, 10);
        addWrappedText(`Phone: ${order.customers?.phone || '-'}`, 10);
        addWrappedText(`Address: ${order.address}`, 10);
        addWrappedText(`Order: $${Number(order.order_amount_usd + order.delivery_fee_usd).toFixed(2)}`, 10);
        addWrappedText(`Fee: $${Number(order.delivery_fee_usd).toFixed(2)}`, 10);
        addWrappedText(`Due: $${due.usd.toFixed(2)}`, 10);
        y += 4;
      });
    }

    if (y > 700) {
      doc.addPage();
      y = margin;
    }

    doc.setDrawColor('#d1d5db');
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += lineHeight;

    doc.setFont(undefined, 'bold');
    doc.text('Summary', margin, y);
    y += lineHeight;
    doc.setFont(undefined, 'normal');
    addWrappedText(`Total Orders: ${totals.totalOrders}`);
    addWrappedText(`Order Amount: ${formatAmount(totals.totalOrderAmountUsd, totals.totalOrderAmountLbp)}`);
    addWrappedText(`Delivery Fees: ${formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)}`);
    addWrappedText(`Total Due: ${formatAmount(totals.totalDueToClientUsd, totals.totalDueToClientLbp)}`);

    doc.save(`Statement-${clientName.replace(/[^a-zA-Z0-9]/g, '_')}-${format(new Date(), 'yyyyMMdd')}.pdf`);
    toast.success('Statement exported as PDF');
  };

  const generateWhatsAppText = () => {
    let text = `📋 *STATEMENT - ${clientName}*\n`;
    text += `📅 Period: ${format(new Date(dateFrom), 'MMM dd, yyyy')} - ${format(new Date(dateTo), 'MMM dd, yyyy')}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (instantOrders.length > 0) {
      text += `*INSTANT ORDERS (${instantOrders.length})*\n`;
      text += `─────────────────────\n`;
      instantOrders.forEach((order, idx) => {
        const due = calculateDue(order);
        const orderUsd = Number(order.order_amount_usd || 0);
        const orderLbp = Number(order.order_amount_lbp || 0);
        const feeUsd = Number(order.delivery_fee_usd || 0);
        const feeLbp = Number(order.delivery_fee_lbp || 0);

        text += `\n${idx + 1}. *${order.order_id}*\n`;
        text += `   📅 ${format(new Date(order.created_at), 'MMM dd, yyyy')}\n`;
        text += `   📍 ${order.address}\n`;
        if (order.notes) text += `   📝 ${order.notes}\n`;
        text += `   💰 Order: ${formatAmount(orderUsd, orderLbp)}\n`;
        if (order.driver_paid_for_client) {
          text += `   🚚 Delivery Fee: ${formatAmount(feeUsd, feeLbp)}\n`;
        }
        text += `   ✅ Due: *${formatAmount(due.usd, due.lbp)}*\n`;
      });
      text += `\n`;
    }

    if (ecomOrders.length > 0) {
      text += `*E-COMMERCE ORDERS (${ecomOrders.length})*\n`;
      text += `─────────────────────\n`;
      ecomOrders.forEach((order, idx) => {
        const due = calculateDue(order);
        text += `\n${idx + 1}. *${order.voucher_no || order.order_id}*\n`;
        text += `   👤 ${order.customers?.name || 'N/A'}\n`;
        text += `   📞 ${order.customers?.phone || 'N/A'}\n`;
        text += `   📍 ${order.address}\n`;
        text += `   💵 Order: $${Number(order.order_amount_usd).toFixed(2)}\n`;
        text += `   🚚 Delivery Fee: $${Number(order.delivery_fee_usd).toFixed(2)}\n`;
        text += `   ✅ Due: *$${due.usd.toFixed(2)}*\n`;
      });
      text += `\n`;
    }

    text += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `*SUMMARY*\n`;
    text += `Total Orders: ${totals.totalOrders}\n`;
    text += `Order Amount: ${formatAmount(totals.totalOrderAmountUsd, totals.totalOrderAmountLbp)}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `*NET DUE: ${formatAmount(totals.totalDueToClientUsd, totals.totalDueToClientLbp)}*`;

    return text;
  };

  const copyToClipboard = async () => {
    const text = generateWhatsAppText();
    await navigator.clipboard.writeText(text);
    toast.success('Statement copied to clipboard - ready to paste in WhatsApp!');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Statement Preview - {clientName}</span>
          </DialogTitle>
          <DialogDescription>
            Period: {format(new Date(dateFrom), 'MMM dd, yyyy')} - {format(new Date(dateTo), 'MMM dd, yyyy')}
          </DialogDescription>
        </DialogHeader>

        <div ref={previewRef} className="flex-1 overflow-auto space-y-6 p-4 bg-background border rounded-lg">
          {/* Instant Orders */}
          {instantOrders.length > 0 && (
            <div>
              <h3 className="font-semibold text-lg mb-3 border-b pb-2">Instant Orders ({instantOrders.length})</h3>
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Date</TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Driver Paid</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instantOrders.map((order) => {
                    const due = calculateDue(order);
                    const orderUsd = Number(order.order_amount_usd || 0);
                    const orderLbp = Number(order.order_amount_lbp || 0);
                    const feeUsd = Number(order.delivery_fee_usd || 0);
                    const feeLbp = Number(order.delivery_fee_lbp || 0);

                    return (
                      <TableRow key={order.id} className="text-sm">
                        <TableCell>{format(new Date(order.created_at), 'MMM dd')}</TableCell>
                        <TableCell className="font-mono">{order.order_id}</TableCell>
                        <TableCell className="max-w-[150px] truncate">{order.address}</TableCell>
                        <TableCell>
                          {order.driver_paid_for_client ? (
                            <Badge variant="outline" className="text-xs text-blue-600">Yes</Badge>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="max-w-[120px] truncate text-muted-foreground">{order.notes || '-'}</TableCell>
                        <TableCell className="text-right">
                          {formatAmount(orderUsd, orderLbp)}
                        </TableCell>
                        <TableCell className="text-right">
                          {order.driver_paid_for_client ? formatAmount(feeUsd, feeLbp) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatAmount(due.usd, due.lbp)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Ecom Orders */}
          {ecomOrders.length > 0 && (
            <div>
              <h3 className="font-semibold text-lg mb-3 border-b pb-2">E-Commerce Orders ({ecomOrders.length})</h3>
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Voucher #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead className="text-right">Order</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ecomOrders.map((order) => {
                    const due = calculateDue(order);
                    return (
                      <TableRow key={order.id} className="text-sm">
                        <TableCell className="font-mono">{order.voucher_no || order.order_id}</TableCell>
                        <TableCell>{order.customers?.name || '-'}</TableCell>
                        <TableCell>{order.customers?.phone || '-'}</TableCell>
                        <TableCell className="max-w-[150px] truncate">{order.address}</TableCell>
                        <TableCell className="text-right">${Number(order.order_amount_usd + order.delivery_fee_usd).toFixed(2)}</TableCell>
                        <TableCell className="text-right">${Number(order.delivery_fee_usd).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-semibold">${due.usd.toFixed(2)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Summary */}
          <div className="border-t pt-4 mt-4">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-xs text-muted-foreground">Total Orders</p>
                <p className="text-xl font-bold">{totals.totalOrders}</p>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-xs text-muted-foreground">Amount</p>
                <p className="text-lg font-bold">
                  {formatAmount(totals.totalOrderAmountUsd, totals.totalOrderAmountLbp)}
                </p>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-xs text-muted-foreground">Delivery Fee</p>
                <p className="text-lg font-bold">
                  {formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)}
                </p>
              </div>
              <div className="p-3 bg-primary/10 rounded-lg border-2 border-primary">
                <p className="text-xs text-muted-foreground">Total Due</p>
                <p className="text-xl font-bold text-primary">
                  {formatAmount(totals.totalDueToClientUsd, totals.totalDueToClientLbp)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="mr-2 h-4 w-4" />
            Close
          </Button>
          <Button onClick={() => { issueStatementMutation.mutate(); onOpenChange(false); }} disabled={issueStatementMutation.isPending}>
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            Issue Statment
          </Button>
          <Button onClick={() => { exportStatementAsPdf(); onOpenChange(false); }} disabled={issueStatementMutation.isPending}>
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            Export PDF
          </Button>
          <Button onClick={() => { exportStatementAsExcel(); onOpenChange(false); }} disabled={issueStatementMutation.isPending}>
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            Export Excel
          </Button>
          <Button onClick={copyToClipboard}>
            <Copy className="mr-2 h-4 w-4" />
            Copy for WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
