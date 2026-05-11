import { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Copy, Download, X } from 'lucide-react';
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
  collected_amount_usd: number;
  collected_amount_lbp: number;
  delivery_fee_usd: number;
  delivery_fee_lbp: number;
  driver_paid_for_client?: boolean;
  driver_paid_amount_usd?: number;
  driver_paid_amount_lbp?: number;
  delivered_at: string;
  clients?: { name: string };
}

interface DriverStatementPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: Order[];
  driverName: string;
  dateFrom: string;
  dateTo: string;
  totals: {
    totalCollectedUsd: number;
    totalCollectedLbp: number;
    totalDeliveryFeesUsd: number;
    totalDeliveryFeesLbp: number;
    totalDriverPaidUsd: number;
    totalDriverPaidLbp: number;
  };
  netDueUsd: number;
  netDueLbp: number;
}

export function DriverStatementPreview({
  open,
  onOpenChange,
  orders,
  driverName,
  dateFrom,
  dateTo,
  totals,
  netDueUsd,
  netDueLbp,
}: DriverStatementPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);

  const formatAmount = (usd: number, lbp: number) => {
    const parts = [];
    if (usd !== 0) parts.push(`$${usd.toFixed(2)}`);
    if (lbp !== 0) parts.push(`${lbp.toLocaleString()} LL`);
    return parts.length > 0 ? parts.join(' / ') : '-';
  };

  const statementPeriodLabel = `${format(new Date(dateFrom), 'MMM dd, yyyy')} - ${format(new Date(dateTo), 'MMM dd, yyyy')}`;

  const exportStatementAsExcel = () => {
    const workbook = XLSX.utils.book_new();
    const rows: Array<Array<string>> = [
      ['RUNNERS ERP DRIVER STATEMENT'],
      ['Driver', driverName],
      ['Period', statementPeriodLabel],
      [],
      ['Date', 'Order', 'Client', 'Collected', 'Fee', 'Driver Paid'],
    ];

    orders.forEach((order) => {
      const collected = formatAmount(Number(order.collected_amount_usd || 0), Number(order.collected_amount_lbp || 0));
      const fee = formatAmount(Number(order.delivery_fee_usd || 0), Number(order.delivery_fee_lbp || 0));
      const driverPaid = order.driver_paid_for_client
        ? formatAmount(Number(order.driver_paid_amount_usd || 0), Number(order.driver_paid_amount_lbp || 0))
        : '-';
      const orderRef = order.order_type === 'ecom' ? order.voucher_no || order.order_id : order.order_id;

      rows.push([
        order.delivered_at ? format(new Date(order.delivered_at), 'MMM dd, yyyy') : '-',
        orderRef,
        order.clients?.name || '-',
        collected,
        fee,
        driverPaid,
      ]);
    });

    rows.push([], ['SUMMARY']);
    rows.push(['Total Collected', formatAmount(totals.totalCollectedUsd, totals.totalCollectedLbp)]);
    rows.push(['Delivery Fees', formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)]);
    rows.push(['Driver Paid Refund', formatAmount(totals.totalDriverPaidUsd, totals.totalDriverPaidLbp)]);
    rows.push(['Net Due', formatAmount(netDueUsd, netDueLbp)]);

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Driver Statement');
    const fileName = `DriverStatement-${driverName.replace(/[^a-zA-Z0-9]/g, '_')}-${format(new Date(), 'yyyyMMdd')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    toast.success('Statement exported as Excel');
  };

  const exportStatementAsPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const lineHeight = 18;
    let y = margin;

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

    doc.setFillColor('#1d4ed8');
    doc.rect(margin, y, 120, 40, 'F');
    doc.setTextColor('#ffffff');
    doc.setFontSize(14);
    doc.text('RUNNERS', margin + 10, y + 18);
    doc.setFontSize(10);
    doc.text('ERP', margin + 10, y + 34);

    doc.setTextColor('#111827');
    doc.setFontSize(20);
    doc.text('Driver Statement', margin + 150, y + 22);
    doc.setFontSize(10);
    doc.text(`Driver: ${driverName}`, margin + 150, y + 40);
    doc.text(`Period: ${statementPeriodLabel}`, margin + 150, y + 56);

    y += 80;

    addSectionHeader(`Orders (${orders.length})`);
    orders.forEach((order, index) => {
      const collected = formatAmount(Number(order.collected_amount_usd || 0), Number(order.collected_amount_lbp || 0));
      const fee = formatAmount(Number(order.delivery_fee_usd || 0), Number(order.delivery_fee_lbp || 0));
      const driverPaid = order.driver_paid_for_client
        ? formatAmount(Number(order.driver_paid_amount_usd || 0), Number(order.driver_paid_amount_lbp || 0))
        : '-';
      const orderRef = order.order_type === 'ecom' ? order.voucher_no || order.order_id : order.order_id;

      addWrappedText(`${index + 1}. ${orderRef}`, 0, { bold: true });
      addWrappedText(`Date: ${order.delivered_at ? format(new Date(order.delivered_at), 'MMM dd, yyyy') : '-'}`, 10);
      addWrappedText(`Client: ${order.clients?.name || '-'}`, 10);
      addWrappedText(`Collected: ${collected}`, 10);
      addWrappedText(`Fee: ${fee}`, 10);
      if (order.driver_paid_for_client) {
        addWrappedText(`Driver Paid: ${driverPaid}`, 10);
      }
      y += 4;
    });

    if (y > 700) {
      doc.addPage();
      y = margin;
    }

    addSectionHeader('Summary');
    addWrappedText(`Total Collected: ${formatAmount(totals.totalCollectedUsd, totals.totalCollectedLbp)}`);
    addWrappedText(`Delivery Fees: ${formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)}`);
    addWrappedText(`Driver Paid Refund: ${formatAmount(totals.totalDriverPaidUsd, totals.totalDriverPaidLbp)}`);
    addWrappedText(`Net Due: ${formatAmount(netDueUsd, netDueLbp)}`);

    const fileName = `DriverStatement-${driverName.replace(/[^a-zA-Z0-9]/g, '_')}-${format(new Date(), 'yyyyMMdd')}.pdf`;
    doc.save(fileName);
    toast.success('Statement exported as PDF');
  };

  const generateWhatsAppText = () => {
    let text = `📋 *DRIVER STATEMENT - ${driverName}*\n`;
    text += `📅 Period: ${format(new Date(dateFrom), 'MMM dd, yyyy')} - ${format(new Date(dateTo), 'MMM dd, yyyy')}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    text += `*ORDERS (${orders.length})*\n`;
    text += `─────────────────────\n`;

    orders.forEach((order, idx) => {
      const collectedUsd = Number(order.collected_amount_usd || 0);
      const collectedLbp = Number(order.collected_amount_lbp || 0);
      const feeUsd = Number(order.delivery_fee_usd || 0);
      const feeLbp = Number(order.delivery_fee_lbp || 0);
      const driverPaidUsd = Number(order.driver_paid_amount_usd || 0);
      const driverPaidLbp = Number(order.driver_paid_amount_lbp || 0);

      const orderRef = order.order_type === 'ecom' ? (order.voucher_no || order.order_id) : order.order_id;

      text += `\n${idx + 1}. *${orderRef}*\n`;
      text += `   📅 ${order.delivered_at ? format(new Date(order.delivered_at), 'MMM dd, yyyy') : 'N/A'}\n`;
      text += `   🏪 ${order.clients?.name || 'N/A'}\n`;
      text += `   💰 Collected: ${formatAmount(collectedUsd, collectedLbp)}\n`;
      text += `   🚚 Fee: ${formatAmount(feeUsd, feeLbp)}\n`;
      if (order.driver_paid_for_client) {
        text += `   💳 Driver Paid: ${formatAmount(driverPaidUsd, driverPaidLbp)}\n`;
      }
    });

    text += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `*SUMMARY*\n`;
    text += `Total Collected: ${formatAmount(totals.totalCollectedUsd, totals.totalCollectedLbp)}\n`;
    text += `Delivery Fees: ${formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)}\n`;
    text += `Driver Paid Refund: ${formatAmount(totals.totalDriverPaidUsd, totals.totalDriverPaidLbp)}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `*NET DUE: ${formatAmount(netDueUsd, netDueLbp)}*`;

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
            <span>Statement Preview - {driverName}</span>
          </DialogTitle>
          <DialogDescription>
            Period: {format(new Date(dateFrom), 'MMM dd, yyyy')} - {format(new Date(dateTo), 'MMM dd, yyyy')}
          </DialogDescription>
        </DialogHeader>

        <div ref={previewRef} className="flex-1 overflow-auto space-y-6 p-4 bg-background border rounded-lg">
          {/* Orders Table */}
          <div>
            <h3 className="font-semibold text-lg mb-3 border-b pb-2">Orders ({orders.length})</h3>
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Date</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead className="text-right">Driver Paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const collectedUsd = Number(order.collected_amount_usd || 0);
                  const collectedLbp = Number(order.collected_amount_lbp || 0);
                  const feeUsd = Number(order.delivery_fee_usd || 0);
                  const feeLbp = Number(order.delivery_fee_lbp || 0);
                  const driverPaidUsd = Number(order.driver_paid_amount_usd || 0);
                  const driverPaidLbp = Number(order.driver_paid_amount_lbp || 0);
                  const orderRef = order.order_type === 'ecom' ? (order.voucher_no || order.order_id) : order.order_id;

                  return (
                    <TableRow key={order.id} className="text-sm">
                      <TableCell>{order.delivered_at ? format(new Date(order.delivered_at), 'MMM dd') : '-'}</TableCell>
                      <TableCell className="font-mono">{orderRef}</TableCell>
                      <TableCell>{order.clients?.name || '-'}</TableCell>
                      <TableCell className="text-right">
                        {formatAmount(collectedUsd, collectedLbp)}
                      </TableCell>
                      <TableCell className="text-right text-status-success">
                        {formatAmount(feeUsd, feeLbp)}
                      </TableCell>
                      <TableCell className="text-right">
                        {order.driver_paid_for_client ? (
                          <span className="text-status-info">{formatAmount(driverPaidUsd, driverPaidLbp)}</span>
                        ) : '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Summary */}
          <div className="border-t pt-4 mt-4">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-xs text-muted-foreground">Total Collected</p>
                <p className="text-lg font-bold">
                  {formatAmount(totals.totalCollectedUsd, totals.totalCollectedLbp)}
                </p>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-xs text-muted-foreground">Delivery Fees</p>
                <p className="text-lg font-bold text-status-success">
                  {formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)}
                </p>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-xs text-muted-foreground">Driver Paid Refund</p>
                <p className="text-lg font-bold text-status-info">
                  {formatAmount(totals.totalDriverPaidUsd, totals.totalDriverPaidLbp)}
                </p>
              </div>
              <div className="p-3 bg-primary/10 rounded-lg border-2 border-primary">
                <p className="text-xs text-muted-foreground">Net Due</p>
                <p className="text-xl font-bold text-primary">
                  {formatAmount(netDueUsd, netDueLbp)}
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
          <Button variant="outline" onClick={exportStatementAsExcel}>
            <Download className="mr-2 h-4 w-4" />
            Export Excel
          </Button>
          <Button variant="outline" onClick={exportStatementAsPdf}>
            <Download className="mr-2 h-4 w-4" />
            Export PDF
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
