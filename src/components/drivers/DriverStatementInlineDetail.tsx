import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Copy, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import autoTable from 'jspdf-autotable';

interface DriverStatementInlineDetailProps {
  statement: {
    id: string;
    statement_id: string;
    driver_id: string;
    period_from: string;
    period_to: string;
    order_refs: string[] | null;
    total_collected_usd: number | null;
    total_collected_lbp: number | null;
    total_delivery_fees_usd: number | null;
    total_delivery_fees_lbp: number | null;
    total_driver_paid_refund_usd: number | null;
    total_driver_paid_refund_lbp: number | null;
    net_due_usd: number | null;
    net_due_lbp: number | null;
    drivers?: { name: string };
  };
}

export function DriverStatementInlineDetail({ statement }: DriverStatementInlineDetailProps) {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['statement-orders-inline', statement.id],
    queryFn: async () => {
      if (!statement.order_refs?.length) return [];

      const { data, error } = await supabase
        .from('orders')
        .select(`*, clients(name)`)
        .or(statement.order_refs.map((ref: string) => `order_id.eq.${ref},voucher_no.eq.${ref}`).join(','));

      if (error) throw error;
      return data || [];
    },
    enabled: !!statement.order_refs?.length,
  });

  const formatAmount = (usd: number, lbp: number) => {
    const parts = [];
    if (usd !== 0) parts.push(`$${usd.toFixed(2)}`);
    if (lbp !== 0) parts.push(`${lbp.toLocaleString()} LL`);
    return parts.length > 0 ? parts.join(' / ') : '-';
  };

  const totals = {
    totalCollectedUsd: Number(statement.total_collected_usd || 0),
    totalCollectedLbp: Number(statement.total_collected_lbp || 0),
    totalDeliveryFeesUsd: Number(statement.total_delivery_fees_usd || 0),
    totalDeliveryFeesLbp: Number(statement.total_delivery_fees_lbp || 0),
    totalDriverPaidUsd: Number(statement.total_driver_paid_refund_usd || 0),
    totalDriverPaidLbp: Number(statement.total_driver_paid_refund_lbp || 0),
  };
  const netDueUsd = Number(statement.net_due_usd || 0);
  const netDueLbp = Number(statement.net_due_lbp || 0);

  const driverName = statement.drivers?.name || 'Driver';
  const formatDateLabel = (dateString: string) => format(new Date(dateString), 'MMM dd, yyyy');
  const statementPeriodLabel = `${formatDateLabel(statement.period_from)} - ${formatDateLabel(statement.period_to)}`;

  // ==========================================
  // EXCEL EXPORT LOGIC
  // ==========================================
  const exportStatementAsExcel = () => {
    const workbook = XLSX.utils.book_new();
    const rows: Array<Array<string | number>> = [
      ['RUNNERS ERP DRIVER STATEMENT PREVIEW'],
      ['Driver', driverName],
      ['Period Range', statementPeriodLabel],
      [],
      ['Date', 'Order ID', 'Client', 'Address', 'Notes', 'Collected', 'Fee', 'Driver Paid Refund'],
    ];

    orders.forEach((order: any) => {
      const collectedUsd = Number(order.collected_amount_usd || 0);
      const collectedLbp = Number(order.collected_amount_lbp || 0);
      const feeUsd = Number(order.delivery_fee_usd || 0);
      const feeLbp = Number(order.delivery_fee_lbp || 0);
      const driverPaidUsd = Number(order.driver_paid_amount_usd || 0);
      const driverPaidLbp = Number(order.driver_paid_amount_lbp || 0);
      const orderRef = order.order_type === 'ecom' ? (order.voucher_no || order.order_id) : order.order_id;

      rows.push([
        order.delivered_at ? format(new Date(order.delivered_at), 'MMM dd, yyyy') : '-',
        orderRef,
        order.clients?.name || '-',
        order.address || '-',
        order.notes || '-',
        formatAmount(collectedUsd, collectedLbp),
        formatAmount(feeUsd, feeLbp),
        order.driver_paid_for_client ? formatAmount(driverPaidUsd, driverPaidLbp) : '-',
      ]);
    });

    rows.push([], ['SUMMARY']);
    rows.push(['Total Orders', orders.length]);
    rows.push(['Total Collected', formatAmount(totals.totalCollectedUsd, totals.totalCollectedLbp)]);
    rows.push(['Delivery Fees', formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)]);
    rows.push(['Driver Paid Refund', formatAmount(totals.totalDriverPaidUsd, totals.totalDriverPaidLbp)]);
    rows.push(['Net Due', formatAmount(netDueUsd, netDueLbp)]);

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Preview');
    const fileName = `DriverPreview-${driverName.replace(/[^a-zA-Z0-9]/g, '_')}-${format(new Date(), 'yyyyMMdd_HHmmss')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    toast.success('Driver preview metrics exported as Excel');
  };

  // ==========================================
  // PDF EXPORT LOGIC
  // ==========================================
  const exportStatementAsPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = margin;

    // 1. Header Section
    doc.setFont('Helvetica', 'bold').setFontSize(16);
    doc.setTextColor('#0f172a');
    doc.text('RUNNERS FMCG', margin, y + 15);

    doc.setFont('Helvetica', 'normal').setFontSize(9);
    doc.setTextColor('#64748b');
    doc.text('Distribution Management System', margin, y + 28);

    doc.setFont('Helvetica', 'bold').setFontSize(18);
    doc.setTextColor('#1e40af');
    doc.text('DRIVER STATEMENT', pageWidth - margin, y + 15, { align: 'right' });

    doc.setFont('Helvetica', 'bold').setFontSize(10);
    doc.setTextColor('#ef4444');
    doc.text('DRAFT REPORT', pageWidth - margin, y + 28, { align: 'right' });

    y += 55;

    // Divider Line
    doc.setDrawColor('#e2e8f0').setLineWidth(1).line(margin, y, pageWidth - margin, y);
    y += 20;

    // 2. Metadata Block
    doc.setFillColor('#f8fafc');
    doc.rect(margin, y, pageWidth - (margin * 2), 55, 'F');

    doc.setFont('Helvetica', 'bold').setFontSize(9);
    doc.setTextColor('#475569');
    doc.text('METADATA DETAILS', margin + 15, y + 18);

    doc.setFont('Helvetica', 'normal').setFontSize(9);
    doc.setTextColor('#0f172a');
    doc.text(`Driver: ${driverName}`, margin + 15, y + 34);
    doc.text(`Statement Period: ${statementPeriodLabel}`, margin + 15, y + 46);

    doc.text(`Generated Date: ${format(new Date(), 'MM/dd/yyyy')}`, pageWidth - margin - 15, y + 18, { align: 'right' });
    doc.text(`Currency: USD / LBP`, pageWidth - margin - 15, y + 34, { align: 'right' });
    doc.text(`Total Records: ${orders.length} Orders`, pageWidth - margin - 15, y + 46, { align: 'right' });

    y += 75;

    // 3. Main Data Table
    const tableRows = orders.map((order: any) => {
      const collectedUsd = Number(order.collected_amount_usd || 0);
      const collectedLbp = Number(order.collected_amount_lbp || 0);
      const feeUsd = Number(order.delivery_fee_usd || 0);
      const feeLbp = Number(order.delivery_fee_lbp || 0);
      const driverPaidUsd = Number(order.driver_paid_amount_usd || 0);
      const driverPaidLbp = Number(order.driver_paid_amount_lbp || 0);
      const orderRef = order.order_type === 'ecom' ? (order.voucher_no || order.order_id) : order.order_id;

      return [
        orderRef,
        order.delivered_at ? format(new Date(order.delivered_at), 'MMM dd') : '-',
        order.clients?.name || "-",
        order.address || '-',
        order.notes || '-',
        formatAmount(collectedUsd, collectedLbp),
        formatAmount(feeUsd, feeLbp),
        order.driver_paid_for_client ? formatAmount(driverPaidUsd, driverPaidLbp) : '-',
      ];
    });

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['ORDER ID', 'DATE', 'CLIENT', 'DELIVERY ADDRESS', 'NOTES', 'COLLECTED', 'FEE', 'DRIVER PAID']],
      body: tableRows,
      theme: 'striped',
      headStyles: {
        fillColor: '#1e40af',
        textColor: '#ffffff',
        fontSize: 8,
        fontStyle: 'bold',
        halign: 'left',
      },
      bodyStyles: {
        fontSize: 8,
        textColor: '#334155',
        cellPadding: 6,
      },
      columnStyles: {
        0: { cellWidth: 65 },  // Order ID
        1: { cellWidth: 40 },  // Date
        2: { cellWidth: 65 },  // Client
        3: { cellWidth: 90 },  // Address
        4: { cellWidth: 70 },  // Notes
        5: { cellWidth: 65 },  // Collected
        6: { cellWidth: 60 },  // Fee
        7: { cellWidth: 60 },  // Driver Paid
      },
      styles: {
        overflow: 'linebreak',
      },
      didDrawPage: (data) => {
        y = data.cursor ? data.cursor.y : y;
      }
    });

    const finalY = (doc as any).lastAutoTable.finalY || y;
    y = finalY + 25;

    if (y > 720) {
      doc.addPage();
      y = margin;
    }

    // 4. Financial Summary Block
    const summaryX = pageWidth - margin - 220;

    doc.setFont('Helvetica', 'bold').setFontSize(10);
    doc.setTextColor('#0f172a');
    doc.text('STATEMENT FINANCIAL SUMMARY', summaryX, y);
    y += 8;
    doc.setDrawColor('#cbd5e1').setLineWidth(0.5).line(summaryX, y, pageWidth - margin, y);
    y += 14;

    const printSummaryRow = (label: string, value: string, isBold = false) => {
      doc.setFont('Helvetica', isBold ? 'bold' : 'normal').setFontSize(9);
      doc.setTextColor(isBold ? '#1e40af' : '#475569');
      doc.text(label, summaryX, y);
      doc.text(value, pageWidth - margin, y, { align: 'right' });
      y += 16;
    };

    printSummaryRow('Total Tracked Orders:', String(orders.length));
    printSummaryRow('Total Collected:', formatAmount(totals.totalCollectedUsd, totals.totalCollectedLbp));
    printSummaryRow('Aggregated Delivery Fees:', formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp));
    printSummaryRow('Driver Paid Refund:', formatAmount(totals.totalDriverPaidUsd, totals.totalDriverPaidLbp));

    doc.setDrawColor('#cbd5e1').setLineWidth(0.5).line(summaryX, y - 4, pageWidth - margin, y - 4);
    y += 4;
    printSummaryRow('NET DUE AMOUNT:', formatAmount(netDueUsd, netDueLbp), true);

    // 5. Footer Running Metrics
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont('Helvetica', 'normal').setFontSize(7);
      doc.setTextColor('#94a3b8');
      doc.setDrawColor('#e2e8f0').setLineWidth(0.5).line(margin, 800, pageWidth - margin, 800);
      doc.text(`Generated systematically via: Runners FMCG DMS Platform`, margin, 812);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, 812, { align: 'right' });
    }

    doc.save(`DriverStatement-${driverName.replace(/[^a-zA-Z0-9]/g, '_')}-${format(new Date(), 'yyyyMMdd_HHmmss')}.pdf`);
    toast.success('Driver statement exported successfully');
  };

  // ==========================================
  // WHATSAPP TEXT LOGIC
  // ==========================================
  const generateWhatsAppText = () => {
    const lines = [
      `📋 *Driver Statement*`,
      `Driver: ${driverName}`,
      `Period: ${statementPeriodLabel}`,
      ``,
      `*Orders (${orders.length}):*`,
      ...orders.map((order: any) => {
        const isDriverPaid = order.driver_paid_for_client === true;
        const orderRef = order.order_type === 'ecom' ? (order.voucher_no || order.order_id) : order.order_id;

        if (isDriverPaid) {
          return `• ${orderRef} - Paid: ${formatAmount(Number(order.driver_paid_amount_usd || 0), Number(order.driver_paid_amount_lbp || 0))} (Refund)`;
        }
        return `• ${orderRef} - Collected: ${formatAmount(Number(order.collected_amount_usd || 0), Number(order.collected_amount_lbp || 0))}`;
      }),
      ``,
      `*Summary:*`,
      `Total Collected: ${formatAmount(totals.totalCollectedUsd, totals.totalCollectedLbp)}`,
      `Delivery Fees: ${formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)}`,
      (totals.totalDriverPaidUsd > 0 || totals.totalDriverPaidLbp > 0) ? `Refund to Driver: ${formatAmount(totals.totalDriverPaidUsd, totals.totalDriverPaidLbp)}` : null,
      ``,
      `💰 *Net Due: ${formatAmount(netDueUsd, netDueLbp)}*`
    ].filter(val => val !== null && val !== undefined).join('\n');

    return lines;
  };

  const copyToClipboard = async () => {
    const text = generateWhatsAppText();
    await navigator.clipboard.writeText(text);
    toast.success('Statement copied to clipboard!');
  };

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 bg-muted/30 space-y-4">
      {/* Orders Table UI */}
      <div>
        <div className="flex items-center justify-end gap-2 mb-2">
          <Button variant="outline" size="sm" onClick={copyToClipboard} className="h-7 text-xs">
            <Copy className="mr-1.5 h-3 w-3" />
            Copy for WhatsApp
          </Button>

          <Button size="sm" onClick={exportStatementAsPdf} className="h-7 text-xs" disabled={isLoading || orders.length === 0}>
            <FileText className="mr-1.5 h-3 w-3" /> Export PDF
          </Button>
          <Button size="sm" onClick={exportStatementAsExcel} className="h-7 text-xs" disabled={isLoading || orders.length === 0}>
            <FileText className="mr-1.5 h-3 w-3" /> Export Excel
          </Button>
        </div>

        <div className="border rounded-lg bg-background">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="py-1.5">Date</TableHead>
                <TableHead className="py-1.5">Order</TableHead>
                <TableHead className="py-1.5">Client</TableHead>
                <TableHead className="py-1.5">Address</TableHead>
                <TableHead className="py-1.5">Notes</TableHead>
                <TableHead className="py-1.5 text-right">Collected</TableHead>
                <TableHead className="py-1.5 text-right">Fee</TableHead>
                <TableHead className="py-1.5 text-right">Driver Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order: any) => {
                const collectedUsd = Number(order.collected_amount_usd || 0);
                const collectedLbp = Number(order.collected_amount_lbp || 0);
                const feeUsd = Number(order.delivery_fee_usd || 0);
                const feeLbp = Number(order.delivery_fee_lbp || 0);
                const driverPaidUsd = Number(order.driver_paid_amount_usd || 0);
                const driverPaidLbp = Number(order.driver_paid_amount_lbp || 0);
                const orderRef = order.order_type === 'ecom' ? (order.voucher_no || order.order_id) : order.order_id;

                return (
                  <TableRow key={order.id} className="text-xs">
                    <TableCell className="py-1.5">{order.delivered_at ? format(new Date(order.delivered_at), 'MMM dd') : '-'}</TableCell>
                    <TableCell className="py-1.5 font-mono">{orderRef}</TableCell>
                    <TableCell className="py-1.5">{order.clients?.name || '-'}</TableCell>
                    <TableCell className="py-1.5">{order.address || '-'}</TableCell>
                    <TableCell className="py-1.5">{order.notes || '-'}</TableCell>
                    <TableCell className="py-1.5 text-right">{formatAmount(collectedUsd, collectedLbp)}</TableCell>
                    <TableCell className="py-1.5 text-right text-status-success">{formatAmount(feeUsd, feeLbp)}</TableCell>
                    <TableCell className="py-1.5 text-right">
                      {order.driver_paid_for_client ? (
                        <span className="text-status-info">{formatAmount(driverPaidUsd, driverPaidLbp)}</span>
                      ) : '-'}
                    </TableCell>
                  </TableRow>
                );
              })}
              {orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-4 text-muted-foreground text-xs">
                    No orders found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Summary View Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="p-2 bg-background rounded-lg border text-center">
          <p className="text-[10px] text-muted-foreground">Total Collected</p>
          <p className="text-sm font-bold font-mono">
            {formatAmount(totals.totalCollectedUsd, totals.totalCollectedLbp)}
          </p>
        </div>
        <div className="p-2 bg-background rounded-lg border text-center">
          <p className="text-[10px] text-muted-foreground">Delivery Fees</p>
          <p className="text-sm font-bold font-mono text-status-success">
            {formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)}
          </p>
        </div>
        <div className="p-2 bg-background rounded-lg border text-center">
          <p className="text-[10px] text-muted-foreground">Driver Paid Refund</p>
          <p className="text-sm font-bold font-mono text-status-info">
            {formatAmount(totals.totalDriverPaidUsd, totals.totalDriverPaidLbp)}
          </p>
        </div>
        <div className="p-2 bg-primary/10 rounded-lg border-2 border-primary text-center">
          <p className="text-[10px] text-muted-foreground">Net Due</p>
          <p className="text-base font-bold font-mono text-primary">
            {formatAmount(netDueUsd, netDueLbp)}
          </p>
        </div>
      </div>
    </div>
  );
}