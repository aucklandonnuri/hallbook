export type Hall = { id: string; name: string };
export type Booking = {
  id: string;
  hall_id: string;
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM 24h
  end_time: string;   // HH:MM 24h
  requester_name: string;
  phone: string;
  group_name: string;
  description?: string | null;
  is_series: boolean;
  series_id?: string | null;
  hall?: Hall;
};
