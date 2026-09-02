export interface Course {
  id: number;
  code: string;
  name: string;
  departments: string[];
  instructors: string[];
  description: string;
  bulletin_code: string;
  last_offered: string;
  created_at: string;
}

export interface CourseWithStats extends Course {
  review_count: number;
  avg_quality: number | null;
  avg_difficulty: number | null;
}

export interface Review {
  id: number;
  course_id: number;
  user_id: string;
  quality: number;
  difficulty: number;
  instructor: string;
  hours_per_week: string;
  comment: string;
  created_at: string;
  // 'site' for reviews written here, 'xlsx' for the original import, 'rmp' for
  // ratings scripts/sync-rmp-reviews.js imported. Never shown to users.
  source: string;
  rmp_rating_id: number | null;
}

export interface ReviewFlag {
  id: number;
  review_id: number;
  user_id: string;
  reason: string;
  created_at: string;
}
