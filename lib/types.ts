export type Hall = { id: string; name: string };
export type Booking = {
  id: string;
  hall_id: string;
  date: string;
  start_time: string;
  end_time: string;
  requester_name: string;
  phone: string;
  group_name: string;
  description?: string | null;
  is_series: boolean;
  series_id?: string | null;
  hall?: Hall;
};
