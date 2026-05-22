import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { FileText, Download, CheckCircle, Search, DollarSign, ChevronDown, ChevronUp, Wallet, Clock, TrendingUp, Eye, ChevronsUpDown, Check, Copy, X } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { useAuth } from '@/hooks/useAuth';
import { StatusBadge } from '@/components/ui/status-badge';
import { DriverStatementPreview } from './DriverStatementPreview';
import { DriverStatementInlineDetail } from './DriverStatementInlineDetail';
import { cn } from '@/lib/utils';
import autoTable from 'jspdf-autotable';

export function DriverStatementsTab() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [driverSearchOpen, setDriverSearchOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedStatement, setSelectedStatement] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [amountUsd, setAmountUsd] = useState(0);
  const [amountLbp, setAmountLbp] = useState(0);
  const [pendingExpanded, setPendingExpanded] = useState(true);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewStatement, setPreviewStatement] = useState<any>(null);
  const [expandedStatementId, setExpandedStatementId] = useState<string | null>(null);
  const [issuePreviewOpen, setIssuePreviewOpen] = useState(false);

  const { data: drivers } = useQuery({
    queryKey: ['drivers-for-statement'],
    queryFn: async () => {
      const { data, error } = await supabase.from('drivers').select('*').order('name');
      if (error) throw error;
      console.log(data);
      return data;
    },
  });

  const { data: unassignedDriverTransactions, isLoading: unassignedTransactionsLoading } = useQuery({
    queryKey: ['unassigned-driver-transactions', selectedDriver],
    queryFn: async () => {
      if (!selectedDriver) return [];

      const { data: driverTransactions, error } = await supabase
        .from('driver_transactions')
        .select('*')
        .eq('driver_id', selectedDriver)
        .is('statement_id', null)
        .is('order_ref', null)
        .order('ts', { ascending: false });

      if (error) throw error;
      return driverTransactions;
    },
    enabled: !!selectedDriver,
  });

  const { data: orders, isLoading } = useQuery({
    queryKey: ['driver-pending-orders', selectedDriver, dateFrom, dateTo],
    queryFn: async () => {
      if (!selectedDriver) return [];

      const { data: statementsData } = await supabase
        .from('driver_statements')
        .select('order_refs')
        .eq('driver_id', selectedDriver);

      const usedOrderRefs = new Set<string>();
      statementsData?.forEach(stmt => {
        if (stmt.order_refs) {
          stmt.order_refs.forEach((ref: string) => usedOrderRefs.add(ref));
        }
      });

      const { data, error } = await supabase
        .from('orders')
        .select(`*, customers(phone, name), clients(name)`)
        .eq('driver_id', selectedDriver)
        .eq('driver_remit_status', 'Pending')
        .gte('delivered_at', dateFrom)
        .lte('delivered_at', dateTo + 'T23:59:59')
        .order('delivered_at', { ascending: false });

      if (error) throw error;
      return data?.filter(order => !usedOrderRefs.has(order.order_id)) || [];
    },
    enabled: !!selectedDriver,
  });

  const { data: statementHistory, isLoading: loadingHistory } = useQuery({
    queryKey: ['driver-statements-history', selectedDriver],
    queryFn: async () => {
      const query = supabase
        .from('driver_statements')
        .select(`*, drivers(name)`)
        .order('issued_date', { ascending: false });

      if (selectedDriver) {
        query.eq('driver_id', selectedDriver);
      }

      const { data, error } = await query;
      if (error) throw error;
      console.log(data)
      return data;
    },
  });

  const { data: statementOrders } = useQuery({
    queryKey: ['statement-orders', previewStatement?.id],
    queryFn: async () => {
      if (!previewStatement?.order_refs?.length) return [];

      const { data, error } = await supabase
        .from('orders')
        .select(`*, clients(name)`)
        .or(previewStatement.order_refs.map((ref: string) => `order_id.eq.${ref},voucher_no.eq.${ref}`).join(','));

      if (error) throw error;
      return data || [];
    },
    enabled: !!previewStatement?.order_refs?.length,
  });

  const filteredOrders = orders?.filter(order => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      order.order_id?.toLowerCase().includes(search) ||
      order.clients?.name?.toLowerCase().includes(search) ||
      order.customers?.name?.toLowerCase().includes(search) ||
      order.customers?.phone?.toLowerCase().includes(search)
    );
  }) || [];

  const handleSelectAll = () => {
    if (selectedOrders.length === filteredOrders.length) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(filteredOrders.map(o => o.id));
    }
  };

  const handleToggleOrder = (orderId: string) => {
    setSelectedOrders(prev =>
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    );
  };

  const calculateTotals = (orders) => {

    return orders.reduce((acc, order) => {
      const isDriverPaid = order.driver_paid_for_client === true;
      const isCompanyPaid = order.company_paid_for_order === true;

      if (isCompanyPaid) {
        // Company-paid: Company paid from cashbox, driver has no financial impact
        // No collection or refund for company-paid orders
        return acc;
      } else if (isDriverPaid) {
        // Driver-paid-for-client: Driver paid supplier, did NOT collect from customer
        // We need to refund the driver what they paid (only the order amount, not fees)
        // Delivery fee is due from client later, not relevant to driver settlement
        return {
          ...acc,
          totalDriverPaidUsd: acc.totalDriverPaidUsd + Number(order.driver_paid_amount_usd || 0),
          totalDriverPaidLbp: acc.totalDriverPaidLbp + Number(order.driver_paid_amount_lbp || 0),
          totalDeliveryFeesUsd: acc.totalDeliveryFeesUsd + Number(order.delivery_fee_usd || 0),
          totalDeliveryFeesLbp: acc.totalDeliveryFeesLbp + Number(order.delivery_fee_lbp || 0),
        };
      } else {
        // Normal orders: driver collected from customer (use actual collected_amount from DB)
        // collected_amount includes order amount + delivery fee
        return {
          ...acc,
          totalCollectedUsd: acc.totalCollectedUsd + Number(order.collected_amount_usd || 0),
          totalCollectedLbp: acc.totalCollectedLbp + Number(order.collected_amount_lbp || 0),
          totalDeliveryFeesUsd: acc.totalDeliveryFeesUsd + Number(order.delivery_fee_usd || 0),
          totalDeliveryFeesLbp: acc.totalDeliveryFeesLbp + Number(order.delivery_fee_lbp || 0),
        };
      }
    }, {
      totalCollectedUsd: 0,
      totalCollectedLbp: 0,
      totalDriverPaidUsd: 0,
      totalDriverPaidLbp: 0,
      totalDeliveryFeesUsd: 0,
      totalDeliveryFeesLbp: 0,
    });
  };

  const selectedOrdersData = orders?.filter(o => selectedOrders.includes(o.id)) || [];
  const totals = calculateTotals(selectedOrdersData);
  // Net due FROM driver = what driver collected MINUS what we owe driver (refunds)
  // If negative, we owe the driver money (cash out from cashbox)
  const netDueUsd = totals.totalCollectedUsd - totals.totalDriverPaidUsd;
  const netDueLbp = totals.totalCollectedLbp - totals.totalDriverPaidLbp;
  let netDueUsdWithTransactions = netDueUsd;
  let netDueLbpWithTransactions = netDueLbp;
  let totalPaidToDriverUsd = 0;
  let totalPaidToDriverLbp = 0;

  const statementPeriodLabel = `${format(new Date(dateFrom), 'MMM dd, yyyy')} - ${format(new Date(dateTo), 'MMM dd, yyyy')}`;

  const formatDualAmount = (usd: number, lbp: number) => {
    const parts = [];
    if (usd !== 0) parts.push(`$${usd.toFixed(2)}`);
    if (lbp !== 0) parts.push(`${lbp.toLocaleString()} LL`);
    return parts.length > 0 ? parts.join(' / ') : '-';
  };

  const exportIssueStatementAsExcel = () => {
    const workbook = XLSX.utils.book_new();
    const rows: Array<Array<string>> = [
      ['RUNNERS ERP DRIVER STATEMENT'],
      ['Driver', selectedDriverData?.name || 'Driver'],
      ['Period', statementPeriodLabel],
      [],
      ['Date', 'Order', 'Client', 'Collected', 'Fee', 'Driver Paid'],
    ];

    selectedOrdersData.forEach((order) => {
      rows.push([
        order.delivered_at ? format(new Date(order.delivered_at), 'MMM dd, yyyy') : '-',
        order.order_id,
        order.clients?.name || '-',
        formatDualAmount(Number(order.collected_amount_usd || 0), Number(order.collected_amount_lbp || 0)),
        formatDualAmount(Number(order.delivery_fee_usd || 0), Number(order.delivery_fee_lbp || 0)),
        order.driver_paid_for_client
          ? formatDualAmount(Number(order.driver_paid_amount_usd || 0), Number(order.driver_paid_amount_lbp || 0))
          : '-',
      ]);
    });

    rows.push([], ['SUMMARY']);
    rows.push(['Total Collected', formatDualAmount(totals.totalCollectedUsd, totals.totalCollectedLbp)]);
    rows.push(['Total Delivery Fees', formatDualAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp)]);
    rows.push(['Total Driver Paid Refund', formatDualAmount(totals.totalDriverPaidUsd, totals.totalDriverPaidLbp)]);
    rows.push(['Net Due', formatDualAmount(netDueUsd, netDueLbp)]);

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Driver Statement');
    const fileName = `DriverStatement-${selectedDriverData?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Driver'}-${format(new Date(), 'yyyyMMdd')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    toast.success('Statement exported as Excel');
  };

  const exportIssueStatementAsPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = margin;

    // ==========================================
    // 1. HEADER SECTION (Clean, Corporate Style)
    // ==========================================

    // Left Side: Brand ID
    doc.setFont('Helvetica', 'bold').setFontSize(16);
    doc.setTextColor('#0f172a'); // Slate 900
    doc.text('RUNNERS FMCG', margin, y + 15);

    doc.setFont('Helvetica', 'normal').setFontSize(9);
    doc.setTextColor('#64748b'); // Slate 500
    doc.text('Distribution Management System', margin, y + 28);

    // Right Side: Document Status & Title
    doc.setFont('Helvetica', 'bold').setFontSize(18);
    doc.setTextColor('#1e40af'); // Deep Corporate Blue
    doc.text('DRIVER STATEMENT', pageWidth - margin, y + 15, { align: 'right' });

    doc.setFont('Helvetica', 'bold').setFontSize(10);
    doc.setTextColor('#64748b');
    doc.text('ERP SYSTEM GENERATED', pageWidth - margin, y + 28, { align: 'right' });

    y += 55;

    // Divider Line
    doc.setDrawColor('#e2e8f0').setLineWidth(1).line(margin, y, pageWidth - margin, y);
    y += 20;

    // ==========================================
    // 2. DRIVER & PERIOD DETAILS PANEL (Reference Look)
    // ==========================================
    doc.setFillColor('#f8fafc'); // Light background tint panel
    doc.rect(margin, y, pageWidth - (margin * 2), 55, 'F');

    doc.setFont('Helvetica', 'bold').setFontSize(9);
    doc.setTextColor('#475569');
    doc.text('STATEMENT DETAILS', margin + 15, y + 18);

    doc.setFont('Helvetica', 'normal').setFontSize(9);
    doc.setTextColor('#0f172a');
    doc.text(`Driver: ${selectedDriverData?.name || 'Driver'}`, margin + 15, y + 34);
    doc.text(`Period Range: ${statementPeriodLabel}`, margin + 15, y + 46);

    doc.text(`Export Date: ${format(new Date(), 'MM/dd/yyyy')}`, pageWidth - margin - 15, y + 18, { align: 'right' });
    doc.text(`Currency Base: USD / LBP`, pageWidth - margin - 15, y + 34, { align: 'right' });
    doc.text(`Total Records: ${selectedOrdersData.length} Orders`, pageWidth - margin - 15, y + 46, { align: 'right' });

    y += 75;

    // ==========================================
    // 3. SECTIONS & DATA TABLE
    // ==========================================

    // Prepare rows exactly matching the operational fields of your issue code logic
    const tableRows = selectedOrdersData.map((order, index) => {
      const orderDate = order.delivered_at
        ? format(new Date(order.delivered_at), 'MMM dd, yyyy')
        : '-';

      const driverPaidVal = order.driver_paid_for_client
        ? formatDualAmount(Number(order.driver_paid_amount_usd || 0), Number(order.driver_paid_amount_lbp || 0))
        : '-';

      return [
        String(index + 1),
        orderDate,
        order.order_id,
        order.clients?.name || '-',
        formatDualAmount(Number(order.collected_amount_usd || 0), Number(order.collected_amount_lbp || 0)),
        formatDualAmount(Number(order.delivery_fee_usd || 0), Number(order.delivery_fee_lbp || 0)),
        driverPaidVal
      ];
    });

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['#', 'DELIVERED DATE', 'ORDER ID', 'CLIENT', 'COLLECTED AMOUNT', 'DELIVERY FEE', 'DRIVER PAID REFUND']],
      body: tableRows,
      theme: 'striped',
      headStyles: {
        fillColor: '#1e40af', // Blue Theme Match
        textColor: '#ffffff',
        fontSize: 8,
        fontStyle: 'bold',
        halign: 'left',
      },
      bodyStyles: {
        fontSize: 8,
        textColor: '#334155',
        cellPadding: 7,
      },
      columnStyles: {
        0: { cellWidth: 25 },  // Index
        1: { cellWidth: 80 },  // Date
        2: { cellWidth: 85 },  // Order Reference String
        3: { cellWidth: 95 },  // Client Name
        4: { cellWidth: 85 },  // Collected Metrics
        5: { cellWidth: 70 },  // Fee
        6: { cellWidth: 75, halign: 'right' } // Refund Total
      },
      styles: {
        overflow: 'linebreak',
      },
      didDrawPage: (data) => {
        y = data.cursor ? data.cursor.y : y;
      }
    });

    // Get dynamic ending coordinate post table generation
    const finalY = (doc as any).lastAutoTable.finalY || y;
    y = finalY + 25;

    // Prevent page breaks splitting the Summary container block awkwardly
    if (y > 710) {
      doc.addPage();
      y = margin;
    }

    // ==========================================
    // 4. FINANCIAL SUMMARY AREA (Aligned Right)
    // ==========================================
    const summaryWidth = 240;
    const summaryX = pageWidth - margin - summaryWidth;

    doc.setFont('Helvetica', 'bold').setFontSize(10);
    doc.setTextColor('#0f172a');
    doc.text('DRIVER SUMMARY TOTALS', summaryX, y);
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

    printSummaryRow('Total Tracked Orders:', String(selectedOrdersData.length));
    printSummaryRow('Total Collected:', formatDualAmount(totals.totalCollectedUsd, totals.totalCollectedLbp));
    printSummaryRow('Delivery Fees System Total:', formatDualAmount(totals.totalDeliveryFeesUsd, totals.totalDeliveryFeesLbp));
    printSummaryRow('Driver Paid Out Refund:', formatDualAmount(totals.totalDriverPaidUsd, totals.totalDriverPaidLbp));

    doc.setDrawColor('#cbd5e1').setLineWidth(0.5).line(summaryX, y - 4, pageWidth - margin, y - 4);
    y += 4;
    printSummaryRow('NET DUE AMOUNT:', formatDualAmount(netDueUsd, netDueLbp), true);

    // ==========================================
    // 5. STABLE RUNNING FOOTERS
    // ==========================================
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont('Helvetica', 'normal').setFontSize(7);
      doc.setTextColor('#94a3b8');

      // Bottom Border separator rule
      doc.setDrawColor('#e2e8f0').setLineWidth(0.5).line(margin, 800, pageWidth - margin, 800);

      doc.text(`System Reference: Drivers Distribution Logistics (Runners ERP Workflow)`, margin, 812);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, 812, { align: 'right' });
    }

    // File Name generation logic cleanup matching Driver identification safely
    const formattedDriverName = selectedDriverData?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Driver';
    const fileName = `DriverStatement-${formattedDriverName}-${format(new Date(), 'yyyyMMdd')}.pdf`;

    doc.save(fileName);
    toast.success('Driver Statement exported as clean layout PDF');
  };

  const issueStatementMutation = useMutation({
    mutationFn: async () => {
      if (selectedOrders.length === 0) throw new Error('No orders selected');

      const selectedOrdersData = orders?.filter(o => selectedOrders.includes(o.id)) || [];

      // Validate all orders have delivered_at date
      const ordersWithoutDeliveryDate = selectedOrdersData.filter(o => !o.delivered_at);
      if (ordersWithoutDeliveryDate.length > 0) {
        throw new Error(`${ordersWithoutDeliveryDate.length} order(s) have no delivery date`);
      }

      const orderRefs = selectedOrdersData.map(o => o.order_id);

      // Calculate period from actual delivery dates
      const deliveryDates = selectedOrdersData.map(o => new Date(o.delivered_at).getTime());
      const periodFrom = new Date(Math.min(...deliveryDates)).toISOString().split('T')[0];
      const periodTo = new Date(Math.max(...deliveryDates)).toISOString().split('T')[0];

      const { data: statementIdData, error: idError } = await supabase.rpc('generate_driver_statement_id');
      if (idError) throw idError;

      const { error: insertError } = await supabase.from('driver_statements').insert({
        driver_id: selectedDriver,
        statement_id: statementIdData,
        period_from: periodFrom,
        period_to: periodTo,
        total_collected_usd: totals.totalCollectedUsd,
        total_collected_lbp: totals.totalCollectedLbp,
        total_delivery_fees_usd: 0,
        total_delivery_fees_lbp: 0,
        total_driver_paid_refund_usd: totals.totalDriverPaidUsd,
        total_driver_paid_refund_lbp: totals.totalDriverPaidLbp,
        net_due_usd: netDueUsdWithTransactions,
        net_due_lbp: netDueLbpWithTransactions,// use netDueUsdWithTransactions
        order_refs: orderRefs,
        // status: 'paid',
        status: 'unpaid',
        paid_date: null,
        payment_method: 'cash',
        created_by: user?.id,
      });

      if (insertError) throw insertError;

      console.log("statementIdData");
      console.log(statementIdData);
      console.log("unassignedDriverTransactions");
      console.log(unassignedDriverTransactions);

      const { error: transactionsError } = await supabase.from('driver_transactions').update({
        statement_id: statementIdData,
      }).in('id', unassignedDriverTransactions.map(t => t.id));

      if (transactionsError) throw transactionsError;

      return statementIdData;
    },
    onSuccess: (statementId) => {
      toast.success(`Statement ${statementId} issued and cash collected`);
      queryClient.invalidateQueries({ queryKey: ['driver-pending-orders'] });
      queryClient.invalidateQueries({ queryKey: ['driver-statements-history'] });
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      queryClient.invalidateQueries({ queryKey: ['drivers-for-statement'] });
      queryClient.invalidateQueries({ queryKey: ['cashbox'] });
      queryClient.invalidateQueries({ queryKey: ['driver-transactions'] });
      setSelectedOrders([]);
      setIssuePreviewOpen(false);
    },
    onError: (error) => {
      console.error(error.message)
      toast.error(`Failed: ${error.message}`);
    },
  });

  const markAsPaidMutation = useMutation({
    mutationFn: async () => {
      if (!selectedStatement) throw new Error('No statement selected');

      await supabase.from('driver_statements').update({
        status: 'paid',
        paid_date: new Date().toISOString(),
        payment_method: paymentMethod,
        notes: paymentNotes || null,
      }).eq('id', selectedStatement.id);

      if (selectedStatement) {
        if (selectedStatement.order_refs?.length) {
          const { data: orders } = await supabase
            .from('orders')
            .select('id, order_id, voucher_no, driver_paid_amount_usd, driver_paid_amount_lbp, driver_paid_for_client, company_paid_for_order, driver_id, collected_amount_usd, collected_amount_lbp, driver_paid_reason')
            .or(selectedStatement.order_refs.map((ref: string) => `order_id.eq.${ref},voucher_no.eq.${ref}`).join(','));

          if (orders?.length) {
            console.log("orders: ", orders);
            console.log("selectedOrdersData: ", orders);
            // Batch update all orders
            const orderIds = orders.map(o => o.id);
            await supabase.from('orders').update({
              driver_remit_status: 'Collected',
              driver_remit_date: new Date().toISOString(),
            }).in('id', orderIds);


            const netDueUsd = amountUsd;
            const netDueLbp = amountLbp;

            // Use atomic cashbox update
            // If netDue is positive: driver owes us money (cash in)
            // If netDue is negative: we owe driver money (cash out)
            const today = new Date().toISOString().split('T')[0];
            const cashInUsd = netDueUsd > 0 ? netDueUsd : 0;
            const cashInLbp = netDueLbp > 0 ? netDueLbp : 0;
            const cashOutUsd = netDueUsd < 0 ? Math.abs(netDueUsd) : 0;
            const cashOutLbp = netDueLbp < 0 ? Math.abs(netDueLbp) : 0;

            const { error: cashboxError } = await (supabase.rpc as any)('update_cashbox_atomic', {
              p_date: today,
              p_cash_in_usd: cashInUsd,
              p_cash_in_lbp: cashInLbp,
              p_cash_out_usd: cashOutUsd,
              p_cash_out_lbp: cashOutLbp,
            });

            if (cashboxError) {
              console.log(cashboxError);
              throw cashboxError;
            }

            const { error: cashboxTransactionError } = await (supabase.rpc as any)('add_cashbox_transaction', {
              transaction_type: (cashInUsd - cashOutUsd) + (cashInLbp - cashOutLbp) > 0 ? "IN" : "OUT",
              amount_usd: (cashInUsd - cashOutUsd).toString(),
              amount_lbp: (cashInLbp - cashOutLbp).toString(),
              note: `Statement ${selectedStatement.statement_id} issued for driver ${drivers?.find(d => d.id === (selectedDriver || selectedStatement.driver_id))?.name || selectedDriver || selectedStatement.driver_id}. Net due: $${netDueUsd.toFixed(2)} and ${netDueLbp.toLocaleString()} LL. Orders: ${selectedStatement.order_refs.join(', ')}.`,
              order_ref: selectedStatement.statement_id,
              driver_id: selectedDriver || selectedStatement.driver_id,
              client_id: null,
              third_party_id: null,
            });

            if (cashboxTransactionError) {
              console.log('add_cashbox_transaction', {
                transaction_type: (cashInUsd - cashOutUsd) + (cashInLbp - cashOutLbp) > 0 ? "IN" : "OUT",
                amount_usd: (cashInUsd - cashOutUsd).toString(),
                amount_lbp: (cashInLbp - cashOutLbp).toString(),
                note: `Statement ${selectedStatement.statement_id} issued for driver ${drivers?.find(d => d.id === (selectedDriver || selectedStatement.driver_id))?.name || selectedDriver || selectedStatement.driver_id}. Net due: $${netDueUsd.toFixed(2)} and ${netDueLbp.toLocaleString()} LL. Orders: ${selectedStatement.order_refs.join(', ')}.`,
                order_ref: selectedStatement.statement_id,
                driver_id: selectedDriver || selectedStatement.driver_id,
                client_id: null,
                third_party_id: null,
              })
              console.log(cashboxTransactionError);
              throw cashboxTransactionError;
            } else {
              console.log("Cashbox transaction recorded successfully");
            }
            // Use atomic wallet update
            // This zeros out the driver's wallet by subtracting what we collected and adding back refunds
            const { error: walletError } = await (supabase.rpc as any)('update_driver_wallet_atomic', {
              p_driver_id: selectedDriver || selectedStatement.driver_id,
              p_amount_usd: -netDueUsd,
              p_amount_lbp: -netDueLbp,
            });

            if (walletError) {
              console.log(walletError);
              throw walletError;
            } else {
              console.log("Driver wallet updated successfully");
            }

            // Create transaction record(s)

            // console.log("totals :", totals);
            if (netDueUsd > 0 || netDueLbp > 0) {
              await supabase.from('driver_transactions').insert({
                driver_id: selectedDriver || selectedStatement.driver_id,
                type: 'Debit',
                amount_usd: netDueUsd,
                amount_lbp: netDueLbp,
                statement_id: selectedStatement.statement_id,
                note: `Statement ${selectedStatement.statement_id} - Cash Collected`,
              });
            }

            if (netDueUsd < 0 || netDueLbp < 0) {
              await supabase.from('driver_transactions').insert({
                driver_id: selectedDriver || selectedStatement.driver_id,
                type: 'Credit',
                amount_usd: Math.abs(netDueUsd),
                amount_lbp: Math.abs(netDueLbp),
                statement_id: selectedStatement.statement_id,
                note: `Statement ${selectedStatement.statement_id} - Refund for amounts paid`,
              });
            }

          }

        }
      }

    },
    onSuccess: () => {
      toast.success('Statement marked as paid');
      queryClient.invalidateQueries({ queryKey: ['driver-statements-history'] });
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      queryClient.invalidateQueries({ queryKey: ['drivers-for-statement'] });
      queryClient.invalidateQueries({ queryKey: ['cashbox'] });
      queryClient.invalidateQueries({ queryKey: ['driver-transactions'] });
      setSelectedOrders([]);
      setPaymentDialogOpen(false);
      setSelectedStatement(null);
      setPaymentMethod('cash');
      setPaymentNotes('');
    },
    onError: (error) => {
      toast.error(`Failed: ${error.message}`);
    },
  });

  const selectedDriverData = drivers?.find(d => d.id === selectedDriver);
  const unpaidStatements = statementHistory?.filter(s => s.status === 'unpaid')?.length || 0;
  const totalPending = orders?.length || 0;

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <Card className="border-sidebar-border bg-sidebar/50">
        <CardContent className="pt-4 pb-3">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="md:col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">Driver</Label>
              <Popover open={driverSearchOpen} onOpenChange={setDriverSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={driverSearchOpen}
                    className="w-full justify-between h-9 font-normal"
                  >
                    {selectedDriver
                      ? drivers?.find((d) => d.id === selectedDriver)?.name
                      : "Search driver..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0 bg-popover" align="start">
                  <Command>
                    <CommandInput placeholder="Search driver..." />
                    <CommandList>
                      <CommandEmpty>No driver found.</CommandEmpty>
                      <CommandGroup>
                        {drivers?.map((driver) => (
                          <CommandItem
                            key={driver.id}
                            value={driver.name}
                            onSelect={() => {
                              setSelectedDriver(driver.id);
                              setDriverSearchOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedDriver === driver.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span className="flex-1">{driver.name}</span>
                            <span className="text-xs text-muted-foreground font-mono">
                              ${Number(driver.wallet_usd || 0).toFixed(2)}
                              {Number(driver.wallet_lbp || 0) !== 0 && (
                                <span className="ml-1">/ {Number(driver.wallet_lbp || 0).toLocaleString()} LL</span>
                              )}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {selectedDriver && (
        <div className="grid grid-cols-4 gap-3">
          <Card className="border-sidebar-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Wallet Balance</span>
              </div>
              <div className="mt-1">
                <p className={`text-lg font-bold font-mono ${Number(selectedDriverData?.wallet_usd || 0) < 0 ? 'text-status-error' : 'text-status-success'}`}>
                  ${Number(selectedDriverData?.wallet_usd || 0).toFixed(2)}
                </p>
                {Number(selectedDriverData?.wallet_lbp || 0) !== 0 && (
                  <p className={`text-sm font-mono ${Number(selectedDriverData?.wallet_lbp || 0) < 0 ? 'text-status-error' : 'text-status-success'}`}>
                    {Number(selectedDriverData?.wallet_lbp || 0).toLocaleString()} LL
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="border-sidebar-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Pending Orders</span>
              </div>
              <p className="text-lg font-bold font-mono mt-1">{totalPending}</p>
            </CardContent>
          </Card>
          <Card className="border-sidebar-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Unpaid Statements</span>
              </div>
              <p className={`text-lg font-bold font-mono mt-1 ${unpaidStatements > 0 ? 'text-status-warning' : ''}`}>
                {unpaidStatements}
              </p>
            </CardContent>
          </Card>
          <Card className="border-sidebar-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Selected Total</span>
              </div>
              <p className="text-lg font-bold font-mono mt-1 text-status-success">
                ${netDueUsd.toFixed(2)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Pending Orders Section */}
      {selectedDriver && (
        <Collapsible open={pendingExpanded} onOpenChange={setPendingExpanded}>
          <Card className="border-sidebar-border">
            <CollapsibleTrigger asChild>
              <CardHeader className="py-2 px-4 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    {pendingExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    Pending Orders ({filteredOrders.length})
                  </CardTitle>
                  <div className="flex items-center gap-3">
                    {selectedOrders.length > 0 && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                        {selectedOrders.length} selected
                      </span>
                    )}
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleSelectAll(); }}>
                      {selectedOrders.length === filteredOrders.length ? 'Clear' : 'Select All'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="p-0">
                {isLoading ? (
                  <p className="text-center py-6 text-muted-foreground text-sm">Loading...</p>
                ) : filteredOrders.length > 0 ? (
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background">
                        <TableRow className="text-xs">
                          <TableHead className="w-8 py-2"></TableHead>
                          <TableHead className="py-2">Date</TableHead>
                          <TableHead className="py-2">Order</TableHead>
                          <TableHead className="py-2">Client</TableHead>
                          <TableHead className="py-2">Address</TableHead>
                          <TableHead className="py-2">Notes</TableHead>
                          <TableHead className="py-2 text-right">Collected (incl. Fee)</TableHead>
                          <TableHead className="py-2 text-right">Refund to Driver</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredOrders.map((order) => (
                          <TableRow key={order.id} className="h-8 text-xs">
                            <TableCell className="py-1">
                              <Checkbox
                                checked={selectedOrders.includes(order.id)}
                                onCheckedChange={() => handleToggleOrder(order.id)}
                              />
                            </TableCell>
                            <TableCell className="py-1 text-muted-foreground">
                              {order.delivered_at ? format(new Date(order.delivered_at), 'MMM dd') : '-'}
                            </TableCell>
                            <TableCell className="py-1 font-mono">{order.order_id}</TableCell>
                            <TableCell className="py-1">{order.clients?.name}</TableCell>
                            <TableCell className="py-1">{order.address}</TableCell>
                            <TableCell className="py-1">{order.notes}</TableCell>
                            <TableCell className="py-1 text-right font-mono">
                              {Number(order.collected_amount_usd || 0) > 0 || Number(order.collected_amount_lbp || 0) > 0 ? (
                                <div>
                                  {Number(order.collected_amount_usd || 0) > 0 && <div>${Number(order.collected_amount_usd || 0).toFixed(2)}</div>}
                                  {Number(order.collected_amount_lbp || 0) > 0 && (
                                    <div className={Number(order.collected_amount_usd || 0) > 0 ? "text-muted-foreground text-[10px]" : ""}>{Number(order.collected_amount_lbp || 0).toLocaleString()} LL</div>
                                  )}
                                </div>
                              ) : '-'}
                            </TableCell>
                            <TableCell className="py-1 text-right font-mono">
                              {order.driver_paid_for_client ? (
                                <div className="text-status-info">
                                  {Number(order.driver_paid_amount_usd || 0) > 0 && <div>${Number(order.driver_paid_amount_usd || 0).toFixed(2)}</div>}
                                  {Number(order.driver_paid_amount_lbp || 0) > 0 && (
                                    <div className={Number(order.driver_paid_amount_usd || 0) > 0 ? "text-muted-foreground text-[10px]" : ""}>{Number(order.driver_paid_amount_lbp || 0).toLocaleString()} LL</div>
                                  )}
                                </div>
                              ) : '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-center py-6 text-muted-foreground text-sm">No pending orders in this period.</p>
                )}

                {/* Action Bar */}
                {selectedOrders.length > 0 && (
                  <div className="border-t bg-muted/30 p-3 flex items-center justify-between">
                    <div className="flex items-center gap-6 text-xs">
                      <div>
                        <span className="text-muted-foreground">Collected: </span>
                        <span className="font-mono font-semibold">${totals.totalCollectedUsd.toFixed(2)}</span>
                        {totals.totalCollectedLbp > 0 && (
                          <span className="text-muted-foreground ml-1">/ {totals.totalCollectedLbp.toLocaleString()} LL</span>
                        )}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Refund to Driver: </span>
                        <span className="font-mono font-semibold text-status-info">-${totals.totalDriverPaidUsd.toFixed(2)}</span>
                        {totals.totalDriverPaidLbp > 0 && (
                          <span className="text-muted-foreground ml-1">/ -{totals.totalDriverPaidLbp.toLocaleString()} LL</span>
                        )}
                      </div>
                      <div className="border-l pl-6">
                        <span className="text-muted-foreground">Net Due: </span>
                        <span className="font-mono font-bold text-base">${netDueUsd.toFixed(2)}</span>
                        {netDueLbp !== 0 && (
                          <span className="text-muted-foreground ml-1">/ {netDueLbp.toLocaleString()} LL</span>
                        )}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setIssuePreviewOpen(true)}>
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      Preview & Issue
                    </Button>
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Statement History */}
      <Card className="border-sidebar-border !mb-20">
        <CardHeader className="py-2 px-4">
          <CardTitle className="text-sm font-medium">Statement History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingHistory ? (
            <p className="text-center py-6 text-muted-foreground text-sm">Loading...</p>
          ) : statementHistory && statementHistory.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="py-2 w-8"></TableHead>
                    <TableHead className="py-2">ID</TableHead>
                    {!selectedDriver && <TableHead className="py-2">Driver</TableHead>}
                    <TableHead className="py-2">Period</TableHead>
                    <TableHead className="py-2 text-right">Net Due</TableHead>
                    <TableHead className="py-2 text-center">Orders</TableHead>
                    <TableHead className="py-2 text-center">Status</TableHead>
                    <TableHead className="py-2">Issued</TableHead>
                    <TableHead className="py-2 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statementHistory.map((statement) => (
                    <>
                      <TableRow
                        key={statement.id}
                        className={cn(
                          "h-9 text-xs cursor-pointer hover:bg-muted/50",
                          expandedStatementId === statement.id && "bg-muted/50"
                        )}
                        onClick={() => setExpandedStatementId(
                          expandedStatementId === statement.id ? null : statement.id
                        )}
                      >
                        <TableCell className="py-1">
                          {expandedStatementId === statement.id ? (
                            <ChevronUp className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="py-1 font-mono">{statement.statement_id}</TableCell>
                        {!selectedDriver && <TableCell className="py-1">{statement.drivers?.name}</TableCell>}
                        <TableCell className="py-1 text-muted-foreground">
                          {format(new Date(statement.period_from), 'MMM dd')} - {format(new Date(statement.period_to), 'MMM dd')}
                        </TableCell>
                        <TableCell className="py-1 text-right font-mono font-semibold">
                          <div>${Number(statement.net_due_usd).toFixed(2)}</div>
                          {Number(statement.net_due_lbp || 0) !== 0 && (
                            <div className="text-muted-foreground text-[10px]">{Number(statement.net_due_lbp || 0).toLocaleString()} LL</div>
                          )}
                        </TableCell>
                        <TableCell className="py-1 text-center">{statement.order_refs?.length || 0}</TableCell>
                        <TableCell className="py-1 text-center">
                          <StatusBadge status={statement.status} type="statement" />
                        </TableCell>
                        <TableCell className="py-1 text-muted-foreground">
                          {format(new Date(statement.issued_date), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell className="py-1 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {statement.status === 'unpaid' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => {
                                  setSelectedStatement(statement);
                                  setAmountUsd(statement.net_due_usd);
                                  setAmountLbp(statement.net_due_lbp);
                                  setPaymentDialogOpen(true);
                                }}
                              >
                                <DollarSign className="mr-1 h-3 w-3" />
                                Collect
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedStatementId === statement.id && (
                        <TableRow key={`${statement.id}-detail`}>
                          <TableCell colSpan={selectedDriver ? 8 : 9} className="p-0">
                            <DriverStatementInlineDetail statement={statement} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-center py-6 text-muted-foreground text-sm">
              {selectedDriver ? 'No statements found for this driver.' : 'Select a driver to view history, or view all statements.'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Collect Payment</DialogTitle>
            <DialogDescription>
              {selectedStatement && (
                <span className="block mt-1">
                  Statement <span className="font-mono font-medium">{selectedStatement.statement_id}</span>
                  <br />
                  Amount: <span className="font-mono font-semibold">${Number(selectedStatement.net_due_usd).toFixed(2)}</span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Notes (Optional)</Label>
              <Input value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="Add notes..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount-usd">Amount USD</Label>
                <Input
                  id="amount-usd"
                  type="number"
                  step="0.01"
                  value={amountUsd}
                  onChange={(e) => setAmountUsd(Number(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount-lbp">Amount LBP</Label>
                <Input
                  id="amount-lbp"
                  type="number"
                  step="1000"
                  value={amountLbp}
                  onChange={(e) => setAmountLbp(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => markAsPaidMutation.mutate()} disabled={markAsPaidMutation.isPending}>
              <CheckCircle className="mr-2 h-4 w-4" />
              {markAsPaidMutation.isPending ? 'Processing...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Statement Preview Dialog */}
      {/* Statement Preview for existing statements */}
      {previewStatement && (
        <DriverStatementPreview
          open={previewDialogOpen}
          onOpenChange={setPreviewDialogOpen}
          orders={statementOrders || []}
          driverName={previewStatement.drivers?.name || 'Driver'}
          dateFrom={previewStatement.period_from}
          dateTo={previewStatement.period_to}
          totals={{
            totalCollectedUsd: Number(previewStatement.total_collected_usd || 0),
            totalCollectedLbp: Number(previewStatement.total_collected_lbp || 0),
            totalDeliveryFeesUsd: Number(previewStatement.total_delivery_fees_usd || 0),
            totalDeliveryFeesLbp: Number(previewStatement.total_delivery_fees_lbp || 0),
            totalDriverPaidUsd: Number(previewStatement.total_driver_paid_refund_usd || 0),
            totalDriverPaidLbp: Number(previewStatement.total_driver_paid_refund_lbp || 0),
          }}
          netDueUsd={Number(previewStatement.net_due_usd || 0)}
          netDueLbp={Number(previewStatement.net_due_lbp || 0)}
        />
      )}

      {/* Issue Statement Preview Dialog */}
      {selectedDriver && selectedDriverData && (
        <Dialog open={issuePreviewOpen} onOpenChange={setIssuePreviewOpen}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Statement Preview - {selectedDriverData.name}</DialogTitle>
              <DialogDescription>
                Review the statement before issuing. YReview the statement before issuing. You can copy for WhatsApp and then confirm to collect payment.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Period: {format(new Date(dateFrom), 'MMM dd, yyyy')} - {format(new Date(dateTo), 'MMM dd, yyyy')}
              </div>

              {/* Orders Table */}
              <h4 className='text-sm mb-0'>Pending Orders</h4>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs bg-muted/50">
                      <TableHead className="py-2">Date</TableHead>
                      <TableHead className="py-2">Order</TableHead>
                      <TableHead className="py-2">Client</TableHead>
                      <TableHead className="py-2">Address</TableHead>
                      <TableHead className="py-2 text-right">Amount</TableHead>
                      <TableHead className="py-2 text-right">Fee</TableHead>
                      <TableHead className="py-2 text-right">Collected</TableHead>
                      <TableHead className="py-2 text-right">Note</TableHead>
                      <TableHead className="py-2 text-right">Driver Paid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders?.filter(o => selectedOrders.includes(o.id)).map((order) => {
                      const formatDualAmount = (usd: number, lbp: number) => {
                        const parts = [];
                        if (usd !== 0) parts.push(`$${usd.toFixed(2)}`);
                        if (lbp !== 0) parts.push(`${lbp.toLocaleString()} LL`);
                        return parts.length > 0 ? parts.join(' / ') : '-';
                      };

                      return (
                        <TableRow key={order.id} className="text-xs">
                          <TableCell className="py-1.5">
                            {order.delivered_at ? format(new Date(order.delivered_at), 'MMM dd') : '-'}
                          </TableCell>
                          <TableCell className="py-1.5 font-mono">{order.order_id}</TableCell>
                          <TableCell className="py-1.5">{order.clients?.name}</TableCell>
                          <TableCell className="py-1.5">{order.address || '-'}</TableCell>
                          <TableCell className="py-1.5 text-right font-mono">
                            {formatDualAmount(
                              Number(order.order_amount_usd || 0),
                              Number(order.order_amount_lbp || 0)
                            )}
                          </TableCell>
                          <TableCell className="py-1.5 text-right font-mono text-status-success">
                            {formatDualAmount(
                              Number(order.delivery_fee_usd || 0),
                              Number(order.delivery_fee_lbp || 0)
                            )}
                          </TableCell>
                          <TableCell className="py-1.5 text-right font-mono">
                            {formatDualAmount(
                              Number(order.collected_amount_usd || 0),
                              Number(order.collected_amount_lbp || 0)
                            )}
                          </TableCell>
                          <TableCell className="py-1.5 text-right font-mono">
                            {order.notes ?? "-"}
                          </TableCell>
                          <TableCell className="py-1.5 text-right font-mono text-status-info">
                            {order.driver_paid_for_client
                              ? formatDualAmount(
                                Number(order.driver_paid_amount_usd || 0),
                                Number(order.driver_paid_amount_lbp || 0)
                              )
                              : '-'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* statments Table */}
              {unassignedDriverTransactions && (
                <>
                  <h4 className='text-sm mb-0'>Unassigned Transactions</h4>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs bg-muted/50">
                          <TableHead className="py-2">Date</TableHead>
                          <TableHead className="py-2">Type</TableHead>
                          <TableHead className="py-2">Order Ref</TableHead>
                          <TableHead className="py-2 text-right">Amount USD</TableHead>
                          <TableHead className="py-2 text-right">Amount LBP</TableHead>
                          <TableHead className="py-2">Note</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unassignedTransactionsLoading ? (
                          <TableRow>
                            <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                              Loading transactions...
                            </TableCell>
                          </TableRow>
                        ) : unassignedDriverTransactions?.length ? (
                          unassignedDriverTransactions.map((transaction) => {
                            if (transaction.type == "Credit") {
                              netDueUsdWithTransactions = Number(netDueUsd || 0) + Number(transaction.amount_usd || 0);
                              netDueLbpWithTransactions = Number(netDueLbp || 0) + Number(transaction.amount_lbp || 0);
                              totalPaidToDriverUsd += Number(transaction.amount_usd || 0);
                              totalPaidToDriverLbp += Number(transaction.amount_lbp || 0);
                            } else {
                              netDueUsdWithTransactions = Number(netDueUsd || 0) - Number(transaction.amount_usd || 0);
                              netDueLbpWithTransactions = Number(netDueLbp || 0) - Number(transaction.amount_lbp || 0);
                              totalPaidToDriverUsd -= Number(transaction.amount_usd || 0);
                              totalPaidToDriverLbp -= Number(transaction.amount_lbp || 0);
                            }
                            return (
                              <TableRow key={transaction.id} className="text-xs">
                                <TableCell className="py-1.5 text-muted-foreground">
                                  {transaction.ts ? format(new Date(transaction.ts), 'MMM dd, yyyy') : '-'}
                                </TableCell>
                                <TableCell className="py-1.5">{transaction.type == "Credit" ? "took money" : "payed money"}</TableCell>
                                <TableCell className="py-1.5 font-mono">{transaction.order_ref || '-'}</TableCell>
                                <TableCell className="py-1.5 font-mono text-right">
                                  {transaction.amount_usd != null ? `$${Number(transaction.amount_usd).toFixed(2)}` : '-'}
                                </TableCell>
                                <TableCell className="py-1.5 font-mono text-right">
                                  {transaction.amount_lbp != null ? `${Number(transaction.amount_lbp).toLocaleString()} LL` : '-'}
                                </TableCell>
                                <TableCell className="py-1.5">{transaction.note || '-'}</TableCell>
                              </TableRow>
                            )
                          })
                        ) : (
                          <TableRow>
                            <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                              No unassigned driver transactions found.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}

              {/* Summary */}
              <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Collected by Driver:</span>
                  <span className="font-mono font-semibold">
                    ${totals.totalCollectedUsd.toFixed(2)}
                    {totals.totalCollectedLbp > 0 && <span className="text-muted-foreground ml-1">/ {totals.totalCollectedLbp.toLocaleString()} LL</span>}
                  </span>
                </div>
                {unassignedDriverTransactions && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Paid To Driver:</span>
                    <span className={`font-mono font-semibold ${totalPaidToDriverUsd > 0 ? 'text-destructive' : ''}`}>
                      ${totalPaidToDriverUsd.toFixed(2)}
                      {totalPaidToDriverLbp !== 0 && <span className="text-muted-foreground ml-1">/ {totalPaidToDriverLbp.toLocaleString()} LL</span>}
                    </span>
                  </div>
                )}
                {(totals.totalDriverPaidUsd > 0 || totals.totalDriverPaidLbp > 0) && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Driver Paid (Refund to Driver):</span>
                    <span className="font-mono font-semibold text-status-info">
                      -${totals.totalDriverPaidUsd.toFixed(2)}
                      {totals.totalDriverPaidLbp > 0 && <span className="text-muted-foreground ml-1">/ -{totals.totalDriverPaidLbp.toLocaleString()} LL</span>}
                    </span>
                  </div>
                )}
                <div className="border-t pt-2 flex justify-between text-base font-bold">
                  <span>{netDueUsdWithTransactions >= 0 ? 'Net Due to Company:' : 'Net Refund to Driver:'}</span>
                  <span className={`font-mono ${netDueUsdWithTransactions < 0 ? 'text-destructive' : ''}`}>
                    ${netDueUsdWithTransactions.toFixed(2)}
                    {netDueLbpWithTransactions !== 0 && <span className="ml-1">/ {netDueLbpWithTransactions.toLocaleString()} LL</span>}
                  </span>
                </div>
              </div>

            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setIssuePreviewOpen(false)}>
                <X className="mr-2 h-4 w-4" /> Close
              </Button>
              {issueStatementMutation && (
                <Button
                  onClick={() => issueStatementMutation.mutate()}
                  disabled={issueStatementMutation.isPending || isLoading}
                >
                  <CheckCircle className="mr-1.5 h-4 w-4" /> Issue Statement
                </Button>
              )}
              <Button onClick={exportIssueStatementAsPdf} disabled={isLoading || orders.length === 0}>
                <FileText className="mr-1.5 h-3.5 w-3.5" /> Export PDF
              </Button>
              <Button onClick={exportIssueStatementAsExcel} disabled={isLoading || orders.length === 0}>
                <FileText className="mr-1.5 h-3.5 w-3.5" /> Export Excel
              </Button>
              <Button onClick={() => {
                const selectedOrdersData = orders?.filter(o => selectedOrders.includes(o.id)) || [];
                const formatAmount = (usd: number, lbp: number) => {
                  const parts = [];
                  if (usd !== 0) parts.push(`$${usd.toFixed(2)}`);
                  if (lbp !== 0) parts.push(`${lbp.toLocaleString()} LL`);
                  return parts.length > 0 ? parts.join(' / ') : '-';
                };

                const lines = [
                  `📋 *Driver Statement*`,
                  `Driver: ${selectedDriverData.name}`,
                  `Period: ${format(new Date(dateFrom), 'MMM dd')} - ${format(new Date(dateTo), 'MMM dd, yyyy')}`,
                  ``,
                  `*Orders (${selectedOrdersData.length}):*`,
                  ...selectedOrdersData.map(o => {
                    const isDriverPaid = o.driver_paid_for_client === true;
                    if (isDriverPaid) {
                      return `• ${o.order_id} - Paid: ${formatAmount(Number(o.driver_paid_amount_usd || 0), Number(o.driver_paid_amount_lbp || 0))} (Refund)`;
                    }
                    return `• ${o.order_id} - Collected: ${formatAmount(Number(o.collected_amount_usd || 0), Number(o.collected_amount_lbp || 0))}`;
                  }),
                  ``,
                  `*Summary:*`,
                  `Total Collected: ${formatAmount(totals.totalCollectedUsd, totals.totalCollectedLbp)}`,
                  (totals.totalDriverPaidUsd > 0 || totals.totalDriverPaidLbp > 0) ? `Refund to Driver: -${formatAmount(totals.totalDriverPaidUsd, totals.totalDriverPaidLbp)}` : '',
                  ``,
                  `💰 *Net Due: ${formatAmount(netDueUsd, netDueLbp)}*`
                ].filter(Boolean).join('\n');

                navigator.clipboard.writeText(lines);
                toast.success('Copied to clipboard!');
              }} disabled={isLoading || orders.length === 0}>
                <Copy className="mr-2 h-4 w-4" /> Copy for WhatsApp
              </Button>

            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
