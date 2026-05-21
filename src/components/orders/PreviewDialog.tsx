import { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Copy, FileText, X } from "lucide-react";
import { format } from "date-fns";
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

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
  clients?: { name: string };
  customers?: { phone: string; name?: string; address?: string };
}

interface PreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOrderIds: string[];
  issueStatementMutation?: any; // Made optional since it's an un-issued state preview
}

export function PreviewDialog({
  open,
  onOpenChange,
  selectedOrderIds,
  issueStatementMutation,
}: PreviewDialogProps) {
  const previewRef = useRef<HTMLDivElement>(null);

  // 1. Fetch complete metadata for selected orders
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders-preview', selectedOrderIds],
    queryFn: async () => {
      if (!selectedOrderIds || selectedOrderIds.length === 0) return [];
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          clients (name),
          customers (phone, name, address)
        `)
        .in('id', selectedOrderIds);

      if (error) throw error;
      return data as Order[];
    },
    enabled: open && selectedOrderIds.length > 0,
  });

  // 2. Separate orders by type
  const instantOrders = orders.filter(o => o.order_type === 'instant' || o.order_type === 'errand');
  const ecomOrders = orders.filter(o => o.order_type === 'ecom');

  // 3. Dynamically infer context metadata safely
  const clientName = orders.length > 0
    ? Array.from(new Set(orders.map(o => o.clients?.name).filter(Boolean))).join(', ')
    : 'Multiple Clients';

  const timestamps = orders.map(o => new Date(o.created_at).getTime());
  const dateFrom = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : new Date().toISOString();
  const dateTo = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : new Date().toISOString();

  // 4. Structural Helper Calculations
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

  const totals = orders.reduce((acc, order) => {
    const due = calculateDue(order);
    return {
      totalOrders: acc.totalOrders + 1,
      totalOrderAmountUsd: acc.totalOrderAmountUsd + Number(order.order_amount_usd || 0),
      totalOrderAmountLbp: acc.totalOrderAmountLbp + Number(order.order_amount_lbp || 0),
      totalDeliveryFeesUsd: acc.totalDeliveryFeesUsd + Number(order.delivery_fee_usd || 0),
      totalDeliveryFeesLbp: acc.totalDeliveryFeesLbp + Number(order.delivery_fee_lbp || 0),
      totalDueToClientUsd: acc.totalDueToClientUsd + due.usd,
      totalDueToClientLbp: acc.totalDueToClientLbp + due.lbp,
    };
  }, {
    totalOrders: 0,
    totalOrderAmountUsd: 0,
    totalOrderAmountLbp: 0,
    totalDeliveryFeesUsd: 0,
    totalDeliveryFeesLbp: 0,
    totalDueToClientUsd: 0,
    totalDueToClientLbp: 0,
  });

  const formatAmount = (usd: number, lbp: number) => {
    const parts = [];
    parts.push(`$${usd.toFixed(2)}`);
    parts.push(`${lbp.toLocaleString()} LL`);
    return parts.length > 0 ? parts.join(' / ') : '-';
  };

  const formatDateLabel = (dateString: string) => format(new Date(dateString), 'MMM dd, yyyy');
  const statementPeriodLabel = `${formatDateLabel(dateFrom)} - ${formatDateLabel(dateTo)}`;

  // 5. Exporters
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
    doc.text('Statement Preview', margin + 150, y + 22);
    doc.setFontSize(10);
    doc.text(`Client(s): ${clientName}`, margin + 150, y + 40);
    doc.text(`Range: ${statementPeriodLabel}`, margin + 150, y + 56);

    y += 80;

    const addWrappedText = (text: string, indent = 0, options: { bold?: boolean } = {}) => {
      if (y > 760) {
        doc.addPage();
        y = margin;
      }
      doc.setFont(undefined, options.bold ? 'bold' : 'normal');
      const lines = doc.splitTextToSize(text, pageWidth - margin * 2 - indent);
      lines.forEach((line) => {
        doc.text(line, margin + indent, y);
        y += lineHeight;
      });
    };

    if (instantOrders.length > 0) {
      y += 10;
      doc.setFont(undefined, 'bold').setFontSize(12);
      doc.text(`Instant / Errand Orders (${instantOrders.length})`, margin, y);
      y += lineHeight; doc.setFontSize(10);

      instantOrders.forEach((order, index) => {
        const due = calculateDue(order);
        addWrappedText(`${index + 1}. ${order.order_id} (${formatDateLabel(order.created_at)})`, 0, { bold: true });
        addWrappedText(`Address: ${order.address}`, 10);
        addWrappedText(`Amount: ${formatAmount(Number(order.order_amount_usd || 0), Number(order.order_amount_lbp || 0))}`, 10);
        if (order.driver_paid_for_client) {
          addWrappedText(`Driver Paid: Yes | Fee: ${formatAmount(Number(order.delivery_fee_usd || 0), Number(order.delivery_fee_lbp || 0))}`, 10);
        }
        addWrappedText(`Due: ${formatAmount(due.usd, due.lbp)}`, 10);
        y += 4;
      });
    }

    if (ecomOrders.length > 0) {
      y += 10;
      doc.setFont(undefined, 'bold').setFontSize(12);
      doc.text(`E-Commerce Orders (${ecomOrders.length})`, margin, y);
      y += lineHeight; doc.setFontSize(10);

      ecomOrders.forEach((order, index) => {
        const due = calculateDue(order);
        addWrappedText(`${index + 1}. ${order.voucher_no || order.order_id}`, 0, { bold: true });
        addWrappedText(`Customer: ${order.customers?.name || '-'} | Phone: ${order.customers?.phone || '-'}`, 10);
        addWrappedText(`Address: ${order.address}`, 10);
        addWrappedText(`Due: $${due.usd.toFixed(2)}`, 10);
        y += 4;
      });
    }

    if (y > 700) { doc.addPage(); y = margin; }
    y += lineHeight;
    doc.setDrawColor('#d1d5db').setLineWidth(0.5).line(margin, y, pageWidth - margin, y);
    y += lineHeight;

    doc.setFont(undefined, 'bold').text('Summary', margin, y);
    y += lineHeight; doc.setFont(undefined, 'normal');
    addWrappedText(`Total Orders: ${totals.totalOrders}`);
    addWrappedText(`Order Amount: ${formatAmount(totals.totalOrderAmountUsd, totals.totalOrderAmountLbp)}`);
    addWrappedText(`Delivery Fees: ${formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)}`);
    addWrappedText(`Total Due: ${formatAmount(totals.totalDueToClientUsd, totals.totalDueToClientLbp)}`);

    doc.save(`Preview-${format(new Date(), 'yyyyMMdd_HHmmss')}.pdf`);
    toast.success('Preview exported as PDF');
  };

  const generateWhatsAppText = () => {
    return [
      `📋 *UNISSUED BATCH PREVIEW*`,
      `Client: ${clientName}`,
      `Range: ${format(new Date(dateFrom), 'MMM dd')} - ${format(new Date(dateTo), 'MMM dd, yyyy')}`,
      ``,
      instantOrders.length > 0 ? `*Instant Orders (${instantOrders.length}):*` : null,
      ...instantOrders.map(o => `• ${o.order_id} - Due: ${formatAmount(calculateDue(o).usd, calculateDue(o).lbp)}`),
      instantOrders.length > 0 ? `` : null,

      ecomOrders.length > 0 ? `*E-Commerce Orders (${ecomOrders.length}):*` : null,
      ...ecomOrders.map(o => `• ${o.voucher_no || o.order_id} - Due: $${calculateDue(o).usd.toFixed(2)}`),
      ecomOrders.length > 0 ? `` : null,

      `*Summary:*`,
      `Total Orders: ${totals.totalOrders}`,
      `Order Amount: ${formatAmount(totals.totalOrderAmountUsd, totals.totalOrderAmountLbp)}`,
      ``,
      `💰 *Net Value: ${formatAmount(totals.totalDueToClientUsd, totals.totalDueToClientLbp)}*`
    ].filter(val => val !== null && val !== undefined).join('\n');
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(generateWhatsAppText());
    toast.success('Copied batch preview to clipboard!');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Pre-Issue Statement Preview</DialogTitle>
          <DialogDescription>
            {isLoading ? "Analyzing order weights..." : `Reviewing ${totals.totalOrders} items across structural bounds.`}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Fetching runtime records...
          </div>
        ) : (
          <div ref={previewRef} className="flex-1 overflow-auto space-y-6 p-4 bg-background border rounded-lg">
            {/* Instant Records */}
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
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Fee</TableHead>
                      <TableHead className="text-right">Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {instantOrders.map((order) => {
                      const due = calculateDue(order);
                      return (
                        <TableRow key={order.id} className="text-sm">
                          <TableCell>{format(new Date(order.created_at), 'MMM dd')}</TableCell>
                          <TableCell className="font-mono">{order.order_id}</TableCell>
                          <TableCell className="max-w-[150px] truncate">{order.address}</TableCell>
                          <TableCell>{order.driver_paid_for_client ? <Badge variant="outline" className="text-blue-600">Yes</Badge> : '-'}</TableCell>
                          <TableCell className="text-right">{formatAmount(order.order_amount_usd, order.order_amount_lbp)}</TableCell>
                          <TableCell className="text-right">{order.driver_paid_for_client ? formatAmount(order.delivery_fee_usd, order.delivery_fee_lbp) : '-'}</TableCell>
                          <TableCell className="text-right font-semibold">{formatAmount(due.usd, due.lbp)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Ecom Records */}
            {ecomOrders.length > 0 && (
              <div>
                <h3 className="font-semibold text-lg mb-3 border-b pb-2">E-Commerce Orders ({ecomOrders.length})</h3>
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead>Voucher #</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Customer</TableHead>
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
                          <TableCell>{order.clients?.name || '-'}</TableCell>
                          <TableCell>{order.customers?.name || '-'}</TableCell>
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

            {/* Summary Block Layout */}
            <div className="border-t pt-4 mt-4">
              <div className="grid grid-cols-4 gap-4 text-center">
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground">Total Orders</p>
                  <p className="text-xl font-bold">{totals.totalOrders}</p>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <p className="text-lg font-bold">{formatAmount(totals.totalOrderAmountUsd, totals.totalOrderAmountLbp)}</p>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground">Delivery Fee</p>
                  <p className="text-lg font-bold">{formatAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)}</p>
                </div>
                <div className="p-3 bg-primary/10 rounded-lg border-2 border-primary">
                  <p className="text-xs text-muted-foreground">Total Due</p>
                  <p className="text-xl font-bold text-primary">{formatAmount(totals.totalDueToClientUsd, totals.totalDueToClientLbp)}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="mr-2 h-4 w-4" /> Close
          </Button>
          {issueStatementMutation && (
            <Button
              onClick={() => { issueStatementMutation.mutate(); onOpenChange(false); }}
              disabled={issueStatementMutation.isPending || isLoading}
            >
              <FileText className="mr-1.5 h-3.5 w-3.5" /> Issue Statement
            </Button>
          )}
          <Button onClick={exportStatementAsPdf} disabled={isLoading || orders.length === 0}>
            <FileText className="mr-1.5 h-3.5 w-3.5" /> Export PDF
          </Button>
          <Button onClick={exportStatementAsExcel} disabled={isLoading || orders.length === 0}>
            <FileText className="mr-1.5 h-3.5 w-3.5" /> Export Excel
          </Button>
          <Button onClick={copyToClipboard} disabled={isLoading || orders.length === 0}>
            <Copy className="mr-2 h-4 w-4" /> Copy for WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}