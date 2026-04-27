import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Minus, HandCoins, Receipt, History, Wallet, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import CashboxTransactionDialog from '@/components/cashbox/CashboxTransactionDialog';
import GiveDriverCashDialog from '@/components/cashbox/GiveDriverCashDialog';
import AddExpenseDialog from '@/components/cashbox/AddExpenseDialog';
import CashboxSummaryCards from '@/components/cashbox/CashboxSummaryCards';
import ExpensesTable from '@/components/cashbox/ExpensesTable';
import TransactionHistoryTable from '@/components/cashbox/TransactionHistoryTable';
import AllExpensesTab from '@/components/cashbox/AllExpensesTab';
import { format, addDays, subDays } from 'date-fns';
import { Calendar as Cal } from "@/components/ui/calendar";
import { DateRange } from "react-day-picker";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


const Cashbox = () => {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [addCapitalOpen, setAddCapitalOpen] = useState(false);
  const [withdrawCapitalOpen, setWithdrawCapitalOpen] = useState(false);
  const [giveDriverCashOpen, setGiveDriverCashOpen] = useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('daily');

  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [transactionType, setTransactionType] = useState<string>("All");
  const [search, setSearch] = useState<string>("");

  const goToToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0]);
    setRange({ from: new Date(), to: new Date() });
  };

  const { data: cashbox, isLoading } = useQuery({
    queryKey: ['cashbox', selectedDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cashbox_daily')
        .select('*')
        .gte('date', range?.from.toISOString().split('T')[0] || selectedDate)
        .lte('date', range?.to.toISOString().split('T')[0] || selectedDate)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: expenses } = useQuery({
    queryKey: ['daily-expenses', selectedDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_expenses')
        .select('*, expense_categories(*)')
        .gte('date', range?.from.toISOString().split('T')[0] || selectedDate)
        .lte('date', range?.to.toISOString().split('T')[0] || selectedDate)
        // .eq('date', selectedDate)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: incomeEntries } = useQuery({
    queryKey: ['daily-income', selectedDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounting_entries')
        .select('amount_usd, amount_lbp, category, ts')
        .eq('category', 'DeliveryIncome')
        .gte('ts', range?.from.toISOString().split('T')[0] || selectedDate)
        .lte('ts', (range?.to.toISOString().split('T')[0] || selectedDate) + 'T23:59:59')
      // .gte('ts', selectedDate)
      // .lte('ts', selectedDate + 'T23:59:59');
      if (error) throw error;
      return data;
    },
  });

  const totalExpensesUSD = expenses?.reduce((sum, exp) => sum + Number(exp.amount_usd || 0), 0) || 0;
  const totalExpensesLBP = expenses?.reduce((sum, exp) => sum + Number(exp.amount_lbp || 0), 0) || 0;

  const revenueUSD = incomeEntries?.reduce((sum: number, entry: any) => sum + Number(entry.amount_usd || 0), 0) || 0;
  const revenueLBP = incomeEntries?.reduce((sum: number, entry: any) => sum + Number(entry.amount_lbp || 0), 0) || 0;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Wallet className="h-8 w-8" />
              Cashbox
            </h1>
            <p className="text-muted-foreground mt-1">Daily cash flow management and expense tracking</p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAddCapitalOpen(true)} variant="default" size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Add Capital
            </Button>
            <Button onClick={() => setWithdrawCapitalOpen(true)} variant="outline" size="sm">
              <Minus className="mr-2 h-4 w-4" />
              Withdraw
            </Button>
            <Button onClick={() => setGiveDriverCashOpen(true)} variant="secondary" size="sm">
              <HandCoins className="mr-2 h-4 w-4" />
              Driver Cash
            </Button>
            <Button onClick={() => setAddExpenseOpen(true)} variant="secondary" size="sm">
              <Receipt className="mr-2 h-4 w-4" />
              Add Expense
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="daily" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Daily View
            </TabsTrigger>
            <TabsTrigger value="transactions" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Transactions
            </TabsTrigger>
            <TabsTrigger value="expenses" className="flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              All Expenses
            </TabsTrigger>
          </TabsList>

          {/* Date Navigation - Only show for daily and transactions tabs */}
          {(activeTab === 'daily' || activeTab === 'transactions') && (
            <div className="flex items-center gap-2 mt-4">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-[240px] justify-start text-left font-normal"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {range?.from ? (
                      range.to ? (
                        <>
                          {format(range.from, "yyyy-MM-dd")} →{" "}
                          {format(range.to, "yyyy-MM-dd")}
                        </>
                      ) : (
                        format(range.from, "yyyy-MM-dd")
                      )
                    ) : (
                      <span>Select date range</span>
                    )}
                  </Button>
                </PopoverTrigger>

                <PopoverContent className="w-auto p-0">
                  <Cal
                    mode="range"
                    selected={range}
                    onSelect={setRange}
                    numberOfMonths={2} // optional but nice UX
                  />
                </PopoverContent>
              </Popover>
              <Button variant="outline" onClick={goToToday}>
                Today
              </Button>
              <div className="space-y-2">
                <Select value={transactionType} onValueChange={setTransactionType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="All">All</SelectItem>
                    <SelectItem value="driver">Driver</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="cashbox">Cashbox</SelectItem>
                    <SelectItem value="accounting">Accounting</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Input placeholder="Search transactions..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          )}

          {/* Daily View Tab */}
          <TabsContent value="daily" className="space-y-6 mt-6">
            <CashboxSummaryCards
              cashbox={cashbox}
              revenueUSD={revenueUSD}
              revenueLBP={revenueLBP}
              expensesUSD={totalExpensesUSD}
              expensesLBP={totalExpensesLBP}
            />

            {/* Daily Expenses */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5" />
                  Daily Expenses
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => setAddExpenseOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>
              </CardHeader>
              <CardContent>
                {expenses && expenses.length > 0 ? (
                  <ExpensesTable expenses={expenses} />
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No expenses recorded for this date
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cashbox Notes */}
            {cashbox?.notes && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Cashbox Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-sm whitespace-pre-wrap text-muted-foreground bg-muted p-4 rounded-lg">
                    {cashbox.notes}
                  </pre>
                </CardContent>
              </Card>
            )}

            {!cashbox && !isLoading && (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-center text-muted-foreground">
                    No cashbox data for {format(new Date(range?.from || selectedDate), 'MMMM d, yyyy')}-{format(new Date(range?.to || selectedDate), 'MMMM d, yyyy')}.
                    Add a transaction to initialize.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Transactions Tab */}
          <TabsContent value="transactions" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5" />
                  Transaction History - {format(new Date(range?.from || selectedDate), 'MMMM d, yyyy')}-{format(new Date(range?.to || selectedDate), 'MMMM d, yyyy')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TransactionHistoryTable date={range} type={transactionType == "All" ? null : transactionType} search={search} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* All Expenses Tab */}
          <TabsContent value="expenses" className="mt-6">
            <AllExpensesTab />
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialogs */}
      <CashboxTransactionDialog
        open={addCapitalOpen}
        onOpenChange={setAddCapitalOpen}
        date={range}
        // date={selectedDate}
        type="in"
      />
      <CashboxTransactionDialog
        open={withdrawCapitalOpen}
        onOpenChange={setWithdrawCapitalOpen}
        date={range}
        // date={selectedDate}
        type="out"
      />
      <GiveDriverCashDialog
        open={giveDriverCashOpen}
        onOpenChange={setGiveDriverCashOpen}
        date={range}
      // date={selectedDate}
      />
      <AddExpenseDialog
        open={addExpenseOpen}
        onOpenChange={setAddExpenseOpen}
        // date={range}
        date={selectedDate}
      />
    </Layout>
  );
};

export default Cashbox;
