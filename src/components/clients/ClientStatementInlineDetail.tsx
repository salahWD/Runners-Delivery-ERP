import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import autoTable from 'jspdf-autotable';

interface ClientStatementInlineDetailProps {
  statement: {
    id: string;
    statement_id: string;
    client_id: string;
    period_from: string;
    period_to: string;
    order_refs: string[] | null;
    total_orders: number | null;
    total_order_amount_usd: number | null;
    total_order_amount_lbp: number | null;
    total_delivery_fees_usd: number | null;
    total_delivery_fees_lbp: number | null;
    net_due_usd: number | null;
    net_due_lbp: number | null;
    clients?: { name: string };
  };
}

export function ClientStatementInlineDetail({ statement }: ClientStatementInlineDetailProps) {
  const { data: orders, isLoading } = useQuery({
    queryKey: ['client-statement-orders-inline', statement.id],
    queryFn: async () => {
      if (!statement.order_refs?.length) return [];

      const { data, error } = await supabase
        .from('orders')
        .select(`*, customers(phone, name, address), drivers(name)`)
        .or(statement.order_refs.map((ref: string) => `order_id.eq.${ref},voucher_no.eq.${ref}`).join(','));

      if (error) throw error;
      return data || [];
    },
    enabled: !!statement.order_refs?.length,
  });

  const formatAmount = (usd: number, lbp: number) => {
    const parts = [];
    if (usd > 0) parts.push(`$${usd.toFixed(2)}`);
    if (lbp > 0) parts.push(`${lbp.toLocaleString()} LL`);
    return parts.length > 0 ? parts.join(' / ') : '-';
  };

  const calculateDue = (order: any) => {
    if (order.order_type === 'instant' || order.order_type === 'errand') {
      if (order.driver_paid_for_client) {
        return {
          usd: Number(order.order_amount_usd || 0) + Number(order.delivery_fee_usd || 0),
          lbp: Number(order.order_amount_lbp || 0) + Number(order.delivery_fee_lbp || 0),
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

  const totals = {
    totalOrders: Number(statement.total_orders || 0),
    totalOrderAmountUsd: Number(statement.total_order_amount_usd || 0),
    totalOrderAmountLbp: Number(statement.total_order_amount_lbp || 0),
    totalDeliveryFeesUsd: Number(statement.total_delivery_fees_usd || 0),
    totalDeliveryFeesLbp: Number(statement.total_delivery_fees_lbp || 0),
    totalDueToClientUsd: Number(statement.net_due_usd || 0),
    totalDueToClientLbp: Number(statement.net_due_lbp || 0),
  };

  const instantOrders = orders?.filter((o: any) => o.order_type === 'instant' || o.order_type === 'errand') || [];
  const ecomOrders = orders?.filter((o: any) => o.order_type === 'ecom') || [];

  const clientName = statement.clients?.name || 'Client';
  const formatDateLabel = (dateString: string) => format(new Date(dateString), 'MMM dd, yyyy');
  const statementPeriodLabel = `${formatDateLabel(statement.period_from)} - ${formatDateLabel(statement.period_to)}`;

  const exportStatementAsExcel = () => {
    const workbook = XLSX.utils.book_new();
    const rows: Array<Array<string | number>> = [
      ['RUNNERS ERP BATCH PREVIEW'],
      ['Client(s)', clientName],
      ['Period Range', statementPeriodLabel],
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
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Preview');
    const fileName = `Preview-${format(new Date(), 'yyyyMMdd_HHmmss')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    toast.success('Preview metrics exported as Excel');
  };

  const exportStatementAsPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = margin;

    // ==========================================
    // 1. HEADER SECTION (Clean & Modern Layout)
    // ==========================================

    // Left: Brand Identification
    doc.setFont('Helvetica', 'bold').setFontSize(16);
    doc.setTextColor('#0f172a'); // Slate 900
    doc.text('RUNNERS FMCG', margin, y + 15);

    doc.setFont('Helvetica', 'normal').setFontSize(9);
    doc.setTextColor('#64748b'); // Slate 500
    doc.text('Distribution Management System', margin, y + 28);

    // Right: Document Title / Status Meta
    doc.setFont('Helvetica', 'bold').setFontSize(18);
    doc.setTextColor('#1e40af'); // Classic Corporate Blue
    doc.text('STATEMENT PREVIEW', pageWidth - margin, y + 15, { align: 'right' });

    doc.setFont('Helvetica', 'bold').setFontSize(10);
    doc.setTextColor('#ef4444'); // Red alert badge color for draft status
    doc.text('DRAFT REPORT', pageWidth - margin, y + 28, { align: 'right' });

    y += 55;

    // Divider Line
    doc.setDrawColor('#e2e8f0').setLineWidth(1).line(margin, y, pageWidth - margin, y);
    y += 20;

    // ==========================================
    // 2. ORDER DETAILS / METADATA METRICS BLOCK
    // ==========================================
    doc.setFillColor('#f8fafc'); // Very light grey/blue background panel
    doc.rect(margin, y, pageWidth - (margin * 2), 55, 'F');

    doc.setFont('Helvetica', 'bold').setFontSize(9);
    doc.setTextColor('#475569');
    doc.text('METADATA DETAILS', margin + 15, y + 18);

    // Dynamic Data Rows inside Panel
    doc.setFont('Helvetica', 'normal').setFontSize(9);
    doc.setTextColor('#0f172a');
    doc.text(`Client(s): ${clientName || 'N/A'}`, margin + 15, y + 34);
    doc.text(`Statement Period: ${statementPeriodLabel || 'All Time'}`, margin + 15, y + 46);

    doc.text(`Generated Date: ${format(new Date(), 'MM/dd/yyyy')}`, pageWidth - margin - 15, y + 18, { align: 'right' });
    doc.text(`Currency: USD / LBP`, pageWidth - margin - 15, y + 34, { align: 'right' });
    doc.text(`Total Records: ${totals.totalOrders} Orders`, pageWidth - margin - 15, y + 46, { align: 'right' });

    y += 75;

    // ==========================================
    // 3. MAIN DATA TABLE (Replacing messy lists)
    // ==========================================
    const allOrders = [...instantOrders, ...ecomOrders];

    // Map your customized fields directly into visual structural rows
    const tableRows = allOrders.map((order, index) => {
      // const due = calculateDue(order);
      const orderIdentifier = order.order_type === 'ecom'
        ? (order.voucher_no || order.order_id)
        : order.order_id;

      // Compile dynamic, descriptive summary strings per cell row
      // const entityDetails = order.order_type === 'ecom'
      //   ? `Cust: ${order.customers?.name || '-'}\nPh: ${order.customers?.phone || '-'}`
      //   : `Instant Fleet Order\nPaid to Driver: ${order.driver_paid_for_client ? 'Yes' : 'No'}`;

      return [
        orderIdentifier || String(index + 1),
        formatDateLabel(order.created_at),
        order.customers?.name || "-",
        order.customers?.phone || "-",
        order.address || '-',
        formatAmount(Number(order.order_amount_usd || 0), Number(order.order_amount_lbp || 0)),
        formatAmount(Number(order.delivery_fee_usd || 0), Number(order.delivery_fee_lbp || 0)),
        // `Amt: ${formatAmount(Number(order.order_amount_usd || 0), Number(order.order_amount_lbp || 0))}\nFee: ${formatAmount(Number(order.delivery_fee_usd || 0), Number(order.delivery_fee_lbp || 0))}`,
        // formatAmount(due.usd, due.lbp)
      ];
    });

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['ID', 'DATE', 'CONTACT', 'PHONE', 'DELIVERY ADDRESS', 'AMOUNT', 'FEE'/* , 'TOTAL DUE' */]],
      body: tableRows,
      theme: 'striped',
      headStyles: {
        fillColor: '#1e40af', // Blue standard theme from your reference requirement
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
        0: { cellWidth: 40 },  // ID
        1: { cellWidth: 75 },  // Date
        2: { cellWidth: 75 },  // Contact
        3: { cellWidth: 65 }, // phone
        4: { cellWidth: 100 }, // Address
        5: { cellWidth: 80 }, // amount
        6: { cellWidth: 80 }, // fee
        // 6: { cellWidth: 70, fontStyle: 'bold', halign: 'right' }  // Balance Line items
      },
      styles: {
        overflow: 'linebreak',
      },
      didDrawPage: (data) => {
        // Dynamic y alignment sync updates if multiple page height calculations jump
        y = data.cursor ? data.cursor.y : y;
      }
    });

    // Get final Y position after the automatic table renders to draw summary
    const finalY = (doc as any).lastAutoTable.finalY || y;
    y = finalY + 25;

    // Prevent Summary layout from flowing poorly into the page bounds footer margins
    if (y > 720) {
      doc.addPage();
      y = margin;
    }

    // ==========================================
    // 4. FINANCIAL SUMMARY BLOCK (Aligned Right)
    // ==========================================
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

    printSummaryRow('Total Tracked Orders:', String(totals.totalOrders));
    printSummaryRow('Gross Order Volume:', formatAmount(totals.totalOrderAmountUsd, totals.totalOrderAmountLbp));
    printSummaryRow('Aggregated Delivery Fees:', formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp));

    doc.setDrawColor('#cbd5e1').setLineWidth(0.5).line(summaryX, y - 4, pageWidth - margin, y - 4);
    y += 4;
    printSummaryRow('NET DUE TO CLIENT:', formatAmount(totals.totalDueToClientUsd, totals.totalDueToClientLbp), true);

    // ==========================================
    // 5. FOOTER RUNNING METRICS (All Pages)
    // ==========================================
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont('Helvetica', 'normal').setFontSize(7);
      doc.setTextColor('#94a3b8');

      // Top border line for system footer metrics
      doc.setDrawColor('#e2e8f0').setLineWidth(0.5).line(margin, 800, pageWidth - margin, 800);

      // Bottom Meta
      doc.text(`Generated systematically via: Runners FMCG DMS Platform`, margin, 812);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, 812, { align: 'right' });
    }

    // Save actions
    doc.save(`Statement-${format(new Date(), 'yyyyMMdd_HHmmss')}.pdf`);
    toast.success('Professional statement exported successfully');
  };

  const generateWhatsAppText = () => {
    const clientName = statement.clients?.name || 'Client';
    const formatAmount = (usd: number, lbp: number) => {
      const parts = [];
      if (usd !== 0) parts.push(`$${usd.toFixed(2)}`);
      if (lbp !== 0) parts.push(`${lbp.toLocaleString()} LL`);
      return parts.length > 0 ? parts.join(' / ') : '-';
    };

    const lines = [
      `📋 *STATEMENT - ${clientName}*`,
      `Period: ${format(new Date(statement.period_from), 'MMM dd, yyyy')} - ${format(new Date(statement.period_to), 'MMM dd, yyyy')}`,
      ``,

      // Instant Orders Section
      instantOrders.length > 0 ? `*Instant Orders (${instantOrders.length}):*` : null,
      ...instantOrders.map(order => {
        const due = calculateDue(order);
        return `• ${order.order_id} - Due: ${formatAmount(due.usd, due.lbp)}`;
      }),
      instantOrders.length > 0 ? `` : null,

      // E-Commerce Orders Section
      ecomOrders.length > 0 ? `*E-Commerce Orders (${ecomOrders.length}):*` : null,
      ...ecomOrders.map(order => {
        const due = calculateDue(order);
        const orderId = order.voucher_no || order.order_id;
        return `• ${orderId} - Due: ${formatAmount(due.usd, due.lbp)}`;
      }),
      ecomOrders.length > 0 ? `` : null,

      // Summary Section
      `*Summary:*`,
      `Total Orders: ${totals.totalOrders}`,
      `Order Amount: ${formatAmount(totals.totalOrderAmountUsd, totals.totalOrderAmountLbp)}`,
      ``,
      `💰 *Net Due: ${formatAmount(totals.totalDueToClientUsd, totals.totalDueToClientLbp)}*`
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
      {/* Copy Button */}
      <div className="flex justify-end gap-2">
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

      {/* Instant Orders */}
      {instantOrders.length > 0 && (
        <div>
          <h4 className="font-medium text-sm mb-2">Instant Orders ({instantOrders.length})</h4>
          <div className="border rounded-lg bg-background">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead className="py-1.5">Date</TableHead>
                  <TableHead className="py-1.5">Order ID</TableHead>
                  <TableHead className="py-1.5">Address</TableHead>
                  <TableHead className="py-1.5">Notes</TableHead>
                  <TableHead className="py-1.5">Driver Paid</TableHead>
                  <TableHead className="py-1.5 text-right">Order Amount</TableHead>
                  <TableHead className="py-1.5 text-right">Fee</TableHead>
                  {/* <TableHead className="py-1.5 text-right">Due</TableHead> */}
                </TableRow>
              </TableHeader>
              <TableBody>
                {instantOrders.map((order: any) => {
                  // const due = calculateDue(order);
                  const orderUsd = Number(order.order_amount_usd || 0);
                  const orderLbp = Number(order.order_amount_lbp || 0);
                  const feeUsd = Number(order.delivery_fee_usd || 0);
                  const feeLbp = Number(order.delivery_fee_lbp || 0);

                  return (
                    <TableRow key={order.id} className="text-xs">
                      <TableCell className="py-1.5">{format(new Date(order.created_at), 'MMM dd')}</TableCell>
                      <TableCell className="py-1.5 font-mono">{order.order_id}</TableCell>
                      <TableCell className="py-1.5 max-w-[150px] truncate">{order.address}</TableCell>
                      <TableCell className="py-1.5 max-w-[120px] truncate text-muted-foreground">{order.notes || '-'}</TableCell>
                      <TableCell className="py-1.5">
                        {order.driver_paid_for_client ? (
                          <Badge variant="outline" className="text-[10px] text-blue-600">Yes</Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="py-1.5 text-right">
                        {formatAmount(orderUsd, orderLbp)}
                      </TableCell>
                      <TableCell className="py-1.5 text-right">
                        {order.driver_paid_for_client ? formatAmount(feeUsd, feeLbp) : '-'}
                      </TableCell>
                      {/* <TableCell className="py-1.5 text-right font-semibold">
                        {formatAmount(due.usd, due.lbp)}
                      </TableCell> */}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* E-Commerce Orders */}
      {ecomOrders.length > 0 && (
        <div>
          <h4 className="font-medium text-sm mb-2">E-Commerce Orders ({ecomOrders.length})</h4>
          <div className="border rounded-lg bg-background">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead className="py-1.5">Voucher #</TableHead>
                  <TableHead className="py-1.5">Customer</TableHead>
                  <TableHead className="py-1.5">Phone</TableHead>
                  <TableHead className="py-1.5">Address</TableHead>
                  <TableHead className="py-1.5 text-right">Order</TableHead>
                  <TableHead className="py-1.5 text-right">Fee</TableHead>
                  {/* <TableHead className="py-1.5 text-right">Due</TableHead> */}
                </TableRow>
              </TableHeader>
              <TableBody>
                {ecomOrders.map((order: any) => {
                  // const due = calculateDue(order);
                  return (
                    <TableRow key={order.id} className="text-xs">
                      <TableCell className="py-1.5 font-mono">{order.voucher_no || order.order_id}</TableCell>
                      <TableCell className="py-1.5">{order.customers?.name || '-'}</TableCell>
                      <TableCell className="py-1.5">{order.customers?.phone || '-'}</TableCell>
                      <TableCell className="py-1.5 max-w-[150px] truncate">{order.address}</TableCell>
                      <TableCell className="py-1.5 text-right">${Number(order.order_amount_usd).toFixed(2)}</TableCell>
                      <TableCell className="py-1.5 text-right">${Number(order.delivery_fee_usd).toFixed(2)}</TableCell>
                      {/* <TableCell className="py-1.5 text-right font-semibold">${due.usd.toFixed(2)}</TableCell> */}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        <div className="p-2 bg-background rounded-lg border text-center">
          <p className="text-[10px] text-muted-foreground">Total Orders</p>
          <p className="text-base font-bold">{totals.totalOrders}</p>
        </div>
        <div className="p-2 bg-background rounded-lg border text-center">
          <p className="text-[10px] text-muted-foreground">Order Amount</p>
          <p className="text-sm font-bold font-mono">
            {formatAmount(totals.totalOrderAmountUsd, totals.totalOrderAmountLbp)}
          </p>
        </div>
        <div className="p-2 bg-background rounded-lg border text-center">
          <p className="text-[10px] text-muted-foreground">Delivery Fee</p>
          <p className="text-sm font-bold font-mono">
            {formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)}
          </p>
        </div>
        <div className="p-2 bg-primary/10 rounded-lg border-2 border-primary text-center">
          <p className="text-[10px] text-muted-foreground">Total Due</p>
          <p className="text-base font-bold font-mono text-primary">
            {formatAmount(totals.totalDueToClientUsd, totals.totalDueToClientLbp)}
          </p>
        </div>
      </div>
    </div>
  );
}
