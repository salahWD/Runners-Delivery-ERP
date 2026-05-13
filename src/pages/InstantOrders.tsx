import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InstantOrderForm } from "@/components/orders/InstantOrderForm";
import { BulkActionsBar } from "@/components/orders/BulkActionsBar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings, Search, Pencil, Trash2 } from "lucide-react";
import EditOrderDialog from "@/components/orders/EditOrderDialog";
import { AddressSettingsDialog } from "@/components/orders/AddressSettingsDialog";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { formatUSD, formatLBP } from "@/lib/utils";

interface Order {
  id: string;
  order_id: string;
  order_type: "ecom" | "instant" | "errand";
  voucher_no?: string;
  status: string;
  client_id: string;
  driver_id?: string;
  third_party_id?: string;
  order_amount_usd: number;
  order_amount_lbp: number;
  delivery_fee_usd: number;
  delivery_fee_lbp: number;
  address: string;
  notes?: string;
  created_at: string;
  driver_paid_for_client?: boolean;
  driver_paid_amount_usd?: number;
  driver_paid_amount_lbp?: number;
  driver_remit_status?: string;
  company_paid_for_order?: boolean;
  fulfillment?: string;
  clients?: { name: string };
  drivers?: { name: string };
  third_parties?: { name: string };
  customers?: { phone: string; name?: string };
}

// Helper function to determine payment status
const getPaymentStatus = (order: Order) => {
  // const hasOrderAmount = (order.order_amount_usd > 0 || order.order_amount_lbp > 0);

  // No order amount means nothing to collect - mark as Paid
  // if (!hasOrderAmount) {
  //   return { label: "Paid", variant: "default" as const, className: "bg-green-600" };
  // }

  // Driver paid for client - client owes us
  if (order.driver_paid_for_client) {
    if (order.driver_remit_status === 'Collected') {
      return { label: "D-Settled", variant: "default" as const, className: "bg-green-600" };
    }
    return { label: "Due", variant: "destructive" as const };
  }

  // Company paid for order - customer owes us (same logic as driver-paid)
  if ((order as any).company_paid_for_order) {
    if (order.driver_remit_status === 'Collected') {
      return { label: "D-Settled", variant: "default" as const, className: "bg-green-600" };
    }
    return { label: "Due", variant: "destructive" as const };
  }

  // Normal order - we collect for client
  if (order.status === 'Delivered') {
    if (order.driver_remit_status === 'Collected') {
      return { label: "Completed", variant: "default" as const, className: "bg-green-600" };
    }
    return { label: "Collected", variant: "default" as const };
  }

  // Normal order - we collect for client
  if (order.status === 'DriverCollected') {
    if (order.driver_remit_status === 'Collected') {
      return { label: "Completed", variant: "default" as const, className: "bg-green-600" };
    }
    return { label: "Collected", variant: "default" as const };
  }

  return { label: "Pending", variant: "secondary" as const };
};

const InstantOrders = () => {
  const queryClient = useQueryClient();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addressSettingsOpen, setAddressSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<string>("all");
  const [settlementFilter, setSettlementFilter] = useState<string>("all");
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);

  const { data: orders, isLoading } = useQuery({
    queryKey: ["instant-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(`
          *,
          clients(name),
          drivers(name),
          third_parties(name),
          customers(phone, name)
        `)
        .in("order_type", ["instant", "errand"])
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Order[];
    },
  });

  // Real-time subscription for instant updates
  useEffect(() => {
    const channel = supabase
      .channel('instant-orders-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: 'order_type=in.(instant,errand)'
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["instant-orders"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const filteredOrders = useMemo(() => {
    if (!orders) return orders;

    const query = searchQuery.toLowerCase();

    return orders.filter((order) => {
      const date = new Date(order.created_at).toLocaleDateString();
      const matchesSearch = !searchQuery.trim() || (
        order.clients?.name?.toLowerCase().includes(query) ||
        order.drivers?.name?.toLowerCase().includes(query) ||
        order.order_id?.toLowerCase().includes(query) ||
        order.address?.toLowerCase().includes(query) ||
        date?.toLowerCase().includes(query) ||
        (order.status == "Delivered" ? "DriverCollected" : order.status)?.toLowerCase().includes(query) ||
        order.notes?.toLowerCase().includes(query)
      );

      const matchesStatus = statusFilter === "all" || order.status === statusFilter;

      const matchesPayment = paymentFilter === "all" ||
        (paymentFilter === "driver_due" && order.driver_paid_for_client && order.driver_remit_status !== "Collected") ||
        (paymentFilter === "company_due" && order.company_paid_for_order && order.driver_remit_status !== "Collected") ||
        (paymentFilter === "collected" && order.driver_remit_status === "Collected") ||
        (paymentFilter === "pending" && !order.driver_paid_for_client && !order.company_paid_for_order && order.status !== "Delivered" && order.status !== "DriverCollected");

      const matchesFulfillment = fulfillmentFilter === "all" || order.fulfillment === fulfillmentFilter;

      let matchesSettlement = true;
      if (settlementFilter === "pending_delivery") {
        matchesSettlement = order.status !== 'Delivered' && order.status !== 'DriverCollected' && order.status !== 'Cancelled' && order.status !== 'Returned';
      } else if (settlementFilter === "due_settlement") {
        matchesSettlement = order.driver_remit_status !== 'Collected' && (order.status === 'Delivered' || order.status === 'DriverCollected');
      } else if (settlementFilter === "settled") {
        matchesSettlement = order.driver_remit_status === 'Collected';
      }

      return matchesSearch && matchesStatus && matchesPayment && matchesFulfillment && matchesSettlement;
    });
  }, [orders, searchQuery, statusFilter, paymentFilter, fulfillmentFilter, settlementFilter]);

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      New: "secondary",
      Assigned: "outline",
      PickedUp: "default",
      Delivered: "default",
      DriverCollected: "default",
      Returned: "destructive",
      Cancelled: "destructive",
    };
    return <Badge variant={variants[status] || "default"}>{status == "DriverCollected" ? "Delivered" : status}</Badge>;
  };

  const toggleSelectAll = () => {
    const allIds = filteredOrders?.map((o) => o.id) || [];
    if (allIds.every((id) => selectedIds.includes(id))) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allIds);
    }
  };

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((selectedId) => selectedId !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const deleteOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase
        .from('orders')
        .delete()
        .eq('id', orderId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Order deleted successfully' });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['instant-orders'] });
      setDeleteOrderId(null);
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Instant Orders</h1>
          <Button variant="outline" size="sm" onClick={() => setAddressSettingsOpen(true)}>
            <Settings className="h-4 w-4 mr-2" />
            Address Areas
          </Button>
        </div>

        <InstantOrderForm />

        <Card className="!mb-20">
          <CardContent className="p-6">
            <div className="space-y-4 mb-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">All Instant Orders</h3>
                {filteredOrders && filteredOrders.length > 0 && (
                  <Checkbox
                    checked={filteredOrders.every((o) => selectedIds.includes(o.id))}
                    onCheckedChange={toggleSelectAll}
                  />
                )}
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-6 gap-4">
                <div className="relative xl:col-span-2">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by client, driver, address, notes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8"
                    autoFocus
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Order Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="New">New</SelectItem>
                    <SelectItem value="Assigned">Assigned</SelectItem>
                    <SelectItem value="PickedUp">Picked Up</SelectItem>
                    <SelectItem value="Delivered">Delivered</SelectItem>
                    <SelectItem value="DriverCollected">Driver Collected</SelectItem>
                    <SelectItem value="Returned">Returned</SelectItem>
                    <SelectItem value="Cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Payment Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Payment Types</SelectItem>
                    <SelectItem value="driver_due">Driver Due</SelectItem>
                    <SelectItem value="company_due">Company Paid</SelectItem>
                    <SelectItem value="collected">Collected</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={fulfillmentFilter} onValueChange={setFulfillmentFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Fulfillment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Fulfillment</SelectItem>
                    <SelectItem value="InHouse">In-House</SelectItem>
                    <SelectItem value="ThirdParty">Third Party</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={settlementFilter} onValueChange={setSettlementFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Settlement" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Settlement</SelectItem>
                    <SelectItem value="pending_delivery">Pending Delivery</SelectItem>
                    <SelectItem value="due_settlement">Due Settlement</SelectItem>
                    <SelectItem value="settled">Settled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead className="px-1">Client</TableHead>
                  <TableHead className="px-1">Address</TableHead>
                  <TableHead className="px-1">Amount USD</TableHead>
                  <TableHead className="px-1">Amount LBP</TableHead>
                  <TableHead className="px-1">Fee USD</TableHead>
                  <TableHead className="px-1">Fee LBP</TableHead>
                  <TableHead className="px-1">Driver</TableHead>
                  <TableHead className="px-1">Notes</TableHead>
                  <TableHead className="px-1">Order Status</TableHead>
                  <TableHead className="px-1">Payment Status</TableHead>
                  <TableHead className="px-1">Created</TableHead>
                  <TableHead className="px-1 w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders?.map((order) => {
                  const paymentStatus = getPaymentStatus(order);
                  return (
                    <TableRow key={order.id} className="hover:bg-muted/50">
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.includes(order.id)} onCheckedChange={() => toggleSelect(order.id)} />
                      </TableCell>
                      <TableCell className="px-1">{order.clients?.name}</TableCell>
                      <TableCell className="px-1 max-w-[200px] truncate">{order.address}</TableCell>
                      <TableCell className="px-1 font-mono">
                        {order.driver_paid_for_client ? (
                          <span className="text-red-600">{formatUSD(order.driver_paid_amount_usd || order.order_amount_usd)}</span>
                        ) : (
                          formatUSD(order.order_amount_usd)
                        )}
                      </TableCell>
                      <TableCell className="px-1 font-mono">
                        {order.driver_paid_for_client ? (
                          <span className="text-red-600">{formatLBP(order.driver_paid_amount_lbp || order.order_amount_lbp)}</span>
                        ) : (
                          formatLBP(order.order_amount_lbp)
                        )}
                      </TableCell>
                      <TableCell className="px-1 font-mono">{formatUSD(order.delivery_fee_usd)}</TableCell>
                      <TableCell className="px-1 font-mono">{formatLBP(order.delivery_fee_lbp)}</TableCell>
                      <TableCell className="px-1">{order.drivers?.name || "-"}</TableCell>
                      <TableCell className="px-1 max-w-[150px] truncate">{order.notes || "-"}</TableCell>
                      <TableCell className="px-1">{getStatusBadge(order.status)}</TableCell>
                      <TableCell className="px-1">
                        <Badge variant={paymentStatus.variant} className={paymentStatus.className}>
                          {paymentStatus.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-1 text-xs whitespace-nowrap">
                        {new Date(order.created_at).toLocaleDateString()} {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </TableCell>
                      <TableCell className="px-1">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedOrder(order);
                              setDialogOpen(true);
                            }}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteOrderId(order.id);
                            }}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <BulkActionsBar thirdPartyDisabled={true} selectedIds={selectedIds} onClearSelection={() => setSelectedIds([])} />

        {selectedOrder && (
          <EditOrderDialog
            order={selectedOrder}
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) setSelectedOrder(null);
            }}
          />
        )}



        <AddressSettingsDialog open={addressSettingsOpen} onOpenChange={setAddressSettingsOpen} />

        <AlertDialog open={!!deleteOrderId} onOpenChange={(open) => !open && setDeleteOrderId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Order</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this order? This will also delete all related transactions and cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteOrderId && deleteOrderMutation.mutate(deleteOrderId)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  );
};

export default InstantOrders;
