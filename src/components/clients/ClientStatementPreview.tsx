import { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import autoTable from 'jspdf-autotable';
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
    const formatAmount = (usd: number, lbp: number) => {
      const parts = [];
      if (usd !== 0) parts.push(`$${usd.toFixed(2)}`);
      if (lbp !== 0) parts.push(`${lbp.toLocaleString()} LL`);
      return parts.length > 0 ? parts.join(' / ') : '-';
    };

    const lines = [
      `📋 *STATEMENT - ${clientName}*`,
      `Period: ${format(new Date(dateFrom), 'MMM dd')} - ${format(new Date(dateTo), 'MMM dd, yyyy')}`,
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instantOrders.map((order) => {
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
