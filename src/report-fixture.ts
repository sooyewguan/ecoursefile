// What the report RPCs returned for a semester that scripts/capture-report-fixture.ts seeded.
// offerings, departments, facultySummary and lecturers are as the dean reads them, and
// chloeOfferings is report_offerings as Chloé Lefèvre reads it: the offerings she teaches.
import type { DepartmentRow, FacultySummary, LecturerRow, OfferingRow } from './reports.ts'

export const REPORT_FIXTURE: {
  semesterCode: string
  facultySummary: FacultySummary[]
  departments: DepartmentRow[]
  offerings: OfferingRow[]
  lecturers: LecturerRow[]
  chloeOfferings: OfferingRow[]
} = {
  "semesterCode": "2815/2816-2",
  "facultySummary": [
    {
      "offerings": 5,
      "complete_offerings": 3,
      "verified_offerings": 1,
      "counted_sections": 48,
      "uploaded_sections": 34,
      "verified_sections": 10,
      "needs_fix_sections": 2,
      "percent_uploaded": 70.8,
      "percent_verified": 20.8,
      "percent_needs_fix": 4.2
    }
  ],
  "departments": [
    {
      "department_id": "954dc9d1-74b7-4998-afd6-d69d4a690c6d",
      "department_code": "FTMK-4189ea99",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "offerings": 2,
      "complete_offerings": 1,
      "verified_offerings": 1,
      "counted_sections": 19,
      "uploaded_sections": 12,
      "verified_sections": 9,
      "needs_fix_sections": 1,
      "percent_uploaded": 63.2,
      "percent_verified": 47.4,
      "percent_needs_fix": 5.3
    },
    {
      "department_id": "46bbfbaf-7425-4bff-b840-90661df59b09",
      "department_code": "JKP-4189ea99",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "offerings": 3,
      "complete_offerings": 2,
      "verified_offerings": 0,
      "counted_sections": 29,
      "uploaded_sections": 22,
      "verified_sections": 1,
      "needs_fix_sections": 1,
      "percent_uploaded": 75.9,
      "percent_verified": 3.4,
      "percent_needs_fix": 3.4
    }
  ],
  "offerings": [
    {
      "offering_id": "adb6f4fc-eee8-4d66-8d50-593465d41bae",
      "course_code": "BITI2233-4189ea99",
      "course_title": "+Statistik Asas",
      "department_id": "954dc9d1-74b7-4998-afd6-d69d4a690c6d",
      "department_code": "FTMK-4189ea99",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "coordinator_id": "4f76809a-7a44-4ce2-854a-ea5a2b201834",
      "coordinator_name": "=HYPERLINK(\"https://example.com\",\"Open\")",
      "coordinator_email": "report-fixture-006afe36-7999-4657-8693-99625b4b8ab4@seam1.test",
      "status": "incomplete",
      "counted_sections": 10,
      "uploaded_sections": 3,
      "verified_sections": 0,
      "needs_fix_sections": 1,
      "percent_complete": 30,
      "missing_sections": [
        4,
        5,
        6,
        10,
        17,
        18,
        19
      ],
      "section_statuses": [
        "pending_review",
        "needs_fix",
        "pending_review",
        "missing",
        "missing",
        "missing",
        "empty",
        "empty",
        "empty",
        "missing",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "missing",
        "missing",
        "missing"
      ],
      "last_upload_at": "2026-11-24T01:34:34.803753+00:00"
    },
    {
      "offering_id": "37b40a11-027c-4cb8-8857-af0cc14af8bc",
      "course_code": "BITM3423-4189ea99",
      "course_title": "Sains Data\nGunaan",
      "department_id": "46bbfbaf-7425-4bff-b840-90661df59b09",
      "department_code": "JKP-4189ea99",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "coordinator_id": "efd0edb1-9971-41de-89bc-37cebf891fd7",
      "coordinator_name": "@SUM(1+1)",
      "coordinator_email": "report-fixture-8cf1e62d-82ae-4995-b464-a61ae19f8477@seam1.test",
      "status": "pending_review",
      "counted_sections": 10,
      "uploaded_sections": 10,
      "verified_sections": 0,
      "needs_fix_sections": 0,
      "percent_complete": 100,
      "missing_sections": [],
      "section_statuses": [
        "pending_review",
        "pending_review",
        "pending_review",
        "pending_review",
        "pending_review",
        "pending_review",
        "pending_review",
        "empty",
        "empty",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "pending_review",
        "pending_review",
        "pending_review"
      ],
      "last_upload_at": "2026-11-24T01:34:34.80933+00:00"
    },
    {
      "offering_id": "627ad45f-2966-4ff6-9ff4-16d7e50f96aa",
      "course_code": "BITP1113-4189ea99",
      "course_title": "Pemrograman Komputer",
      "department_id": "954dc9d1-74b7-4998-afd6-d69d4a690c6d",
      "department_code": "FTMK-4189ea99",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "coordinator_id": "f4743c30-791a-40e6-8d7c-d19d975cc0d9",
      "coordinator_name": "Aisyah Rahman",
      "coordinator_email": "report-fixture-e2c2f2cc-8d90-4b29-9eab-27b752fb0c07@seam1.test",
      "status": "verified",
      "counted_sections": 9,
      "uploaded_sections": 9,
      "verified_sections": 9,
      "needs_fix_sections": 0,
      "percent_complete": 100,
      "missing_sections": [],
      "section_statuses": [
        "verified",
        "verified",
        "verified",
        "verified",
        "verified",
        "verified",
        "empty",
        "empty",
        "empty",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "verified",
        "verified",
        "verified"
      ],
      "last_upload_at": "2026-11-24T01:34:34.746454+00:00"
    },
    {
      "offering_id": "498eccf1-a080-49b2-8159-4b4d8c12df54",
      "course_code": "BITS3343-4189ea99",
      "course_title": "Pengaturcaraan \"Java\", Lanjutan",
      "department_id": "46bbfbaf-7425-4bff-b840-90661df59b09",
      "department_code": "JKP-4189ea99",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "coordinator_id": "78aa1136-ee34-4973-bb7f-65c0eeddf32e",
      "coordinator_name": "Chloé Lefèvre",
      "coordinator_email": "report-fixture-5cc68ec3-ffd0-4f95-9bec-214de25c3cec@seam1.test",
      "status": "needs_fix",
      "counted_sections": 10,
      "uploaded_sections": 10,
      "verified_sections": 1,
      "needs_fix_sections": 1,
      "percent_complete": 100,
      "missing_sections": [],
      "section_statuses": [
        "verified",
        "pending_review",
        "pending_review",
        "pending_review",
        "pending_review",
        "needs_fix",
        "empty",
        "empty",
        "empty",
        "pending_review",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "pending_review",
        "pending_review",
        "pending_review"
      ],
      "last_upload_at": "2026-11-24T01:34:34.807342+00:00"
    },
    {
      "offering_id": "700b546e-c8a4-47fe-80f6-fa42dd4b3426",
      "course_code": "BITU3973-4189ea99",
      "course_title": "Projek Sarjana Muda",
      "department_id": "46bbfbaf-7425-4bff-b840-90661df59b09",
      "department_code": "JKP-4189ea99",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "coordinator_id": "64294b94-9f3e-4402-9c55-c72d6c4f597e",
      "coordinator_name": "-2+3 Dash",
      "coordinator_email": "report-fixture-e7139a4d-b2c1-4126-9309-4845c7def5ee@seam1.test",
      "status": "incomplete",
      "counted_sections": 9,
      "uploaded_sections": 2,
      "verified_sections": 0,
      "needs_fix_sections": 0,
      "percent_complete": 22.2,
      "missing_sections": [
        2,
        4,
        5,
        6,
        17,
        18,
        19
      ],
      "section_statuses": [
        "pending_review",
        "missing",
        "pending_review",
        "missing",
        "missing",
        "missing",
        "empty",
        "empty",
        "empty",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "missing",
        "missing",
        "missing"
      ],
      "last_upload_at": null
    }
  ],
  "lecturers": [
    {
      "lecturer_id": "8ba9ff2f-da57-4b80-8f14-df828507fa2b",
      "lecturer_name": "\tTabbed Name",
      "lecturer_email": "report-fixture-645f0676-e98d-42ab-9f45-e0f9973615aa@seam1.test",
      "department_id": null,
      "department_code": null,
      "department_name": null,
      "timetable_missing": true,
      "offerings": [
        {
          "coordinator": false,
          "course_code": "BITU3973-4189ea99",
          "offering_id": "700b546e-c8a4-47fe-80f6-fa42dd4b3426",
          "course_title": "Projek Sarjana Muda",
          "department_id": "46bbfbaf-7425-4bff-b840-90661df59b09",
          "department_code": "JKP-4189ea99",
          "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
          "missing_sections": [
            2,
            4,
            5,
            6,
            17,
            18,
            19
          ],
          "needs_fix_sections": []
        }
      ]
    },
    {
      "lecturer_id": "e36590e0-b1cd-46e4-a8f9-f38151aded3b",
      "lecturer_name": "\rReturned Name",
      "lecturer_email": "report-fixture-a38b0e01-2eb7-4962-9c93-95cef4232db1@seam1.test",
      "department_id": null,
      "department_code": null,
      "department_name": null,
      "timetable_missing": true,
      "offerings": [
        {
          "coordinator": false,
          "course_code": "BITU3973-4189ea99",
          "offering_id": "700b546e-c8a4-47fe-80f6-fa42dd4b3426",
          "course_title": "Projek Sarjana Muda",
          "department_id": "46bbfbaf-7425-4bff-b840-90661df59b09",
          "department_code": "JKP-4189ea99",
          "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
          "missing_sections": [
            2,
            4,
            5,
            6,
            17,
            18,
            19
          ],
          "needs_fix_sections": []
        }
      ]
    },
    {
      "lecturer_id": "64294b94-9f3e-4402-9c55-c72d6c4f597e",
      "lecturer_name": "-2+3 Dash",
      "lecturer_email": "report-fixture-e7139a4d-b2c1-4126-9309-4845c7def5ee@seam1.test",
      "department_id": "46bbfbaf-7425-4bff-b840-90661df59b09",
      "department_code": "JKP-4189ea99",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "timetable_missing": true,
      "offerings": [
        {
          "coordinator": true,
          "course_code": "BITU3973-4189ea99",
          "offering_id": "700b546e-c8a4-47fe-80f6-fa42dd4b3426",
          "course_title": "Projek Sarjana Muda",
          "department_id": "46bbfbaf-7425-4bff-b840-90661df59b09",
          "department_code": "JKP-4189ea99",
          "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
          "missing_sections": [
            2,
            4,
            5,
            6,
            17,
            18,
            19
          ],
          "needs_fix_sections": []
        }
      ]
    },
    {
      "lecturer_id": "efd0edb1-9971-41de-89bc-37cebf891fd7",
      "lecturer_name": "@SUM(1+1)",
      "lecturer_email": "report-fixture-8cf1e62d-82ae-4995-b464-a61ae19f8477@seam1.test",
      "department_id": "46bbfbaf-7425-4bff-b840-90661df59b09",
      "department_code": "JKP-4189ea99",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "timetable_missing": false,
      "offerings": [
        {
          "coordinator": true,
          "course_code": "BITM3423-4189ea99",
          "offering_id": "37b40a11-027c-4cb8-8857-af0cc14af8bc",
          "course_title": "Sains Data\nGunaan",
          "department_id": "46bbfbaf-7425-4bff-b840-90661df59b09",
          "department_code": "JKP-4189ea99",
          "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
          "missing_sections": [],
          "needs_fix_sections": []
        }
      ]
    },
    {
      "lecturer_id": "4f76809a-7a44-4ce2-854a-ea5a2b201834",
      "lecturer_name": "=HYPERLINK(\"https://example.com\",\"Open\")",
      "lecturer_email": "report-fixture-006afe36-7999-4657-8693-99625b4b8ab4@seam1.test",
      "department_id": "954dc9d1-74b7-4998-afd6-d69d4a690c6d",
      "department_code": "FTMK-4189ea99",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "timetable_missing": false,
      "offerings": [
        {
          "coordinator": true,
          "course_code": "BITI2233-4189ea99",
          "offering_id": "adb6f4fc-eee8-4d66-8d50-593465d41bae",
          "course_title": "+Statistik Asas",
          "department_id": "954dc9d1-74b7-4998-afd6-d69d4a690c6d",
          "department_code": "FTMK-4189ea99",
          "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
          "missing_sections": [
            5,
            6,
            10,
            17,
            18,
            19
          ],
          "needs_fix_sections": [
            2
          ]
        }
      ]
    },
    {
      "lecturer_id": "f4743c30-791a-40e6-8d7c-d19d975cc0d9",
      "lecturer_name": "Aisyah Rahman",
      "lecturer_email": "report-fixture-e2c2f2cc-8d90-4b29-9eab-27b752fb0c07@seam1.test",
      "department_id": "954dc9d1-74b7-4998-afd6-d69d4a690c6d",
      "department_code": "FTMK-4189ea99",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "timetable_missing": false,
      "offerings": [
        {
          "coordinator": true,
          "course_code": "BITP1113-4189ea99",
          "offering_id": "627ad45f-2966-4ff6-9ff4-16d7e50f96aa",
          "course_title": "Pemrograman Komputer",
          "department_id": "954dc9d1-74b7-4998-afd6-d69d4a690c6d",
          "department_code": "FTMK-4189ea99",
          "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
          "missing_sections": [],
          "needs_fix_sections": []
        }
      ]
    },
    {
      "lecturer_id": "78aa1136-ee34-4973-bb7f-65c0eeddf32e",
      "lecturer_name": "Chloé Lefèvre",
      "lecturer_email": "report-fixture-5cc68ec3-ffd0-4f95-9bec-214de25c3cec@seam1.test",
      "department_id": "46bbfbaf-7425-4bff-b840-90661df59b09",
      "department_code": "JKP-4189ea99",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "timetable_missing": false,
      "offerings": [
        {
          "coordinator": false,
          "course_code": "BITP1113-4189ea99",
          "offering_id": "627ad45f-2966-4ff6-9ff4-16d7e50f96aa",
          "course_title": "Pemrograman Komputer",
          "department_id": "954dc9d1-74b7-4998-afd6-d69d4a690c6d",
          "department_code": "FTMK-4189ea99",
          "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
          "missing_sections": [],
          "needs_fix_sections": []
        },
        {
          "coordinator": true,
          "course_code": "BITS3343-4189ea99",
          "offering_id": "498eccf1-a080-49b2-8159-4b4d8c12df54",
          "course_title": "Pengaturcaraan \"Java\", Lanjutan",
          "department_id": "46bbfbaf-7425-4bff-b840-90661df59b09",
          "department_code": "JKP-4189ea99",
          "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
          "missing_sections": [],
          "needs_fix_sections": [
            6
          ]
        }
      ]
    },
    {
      "lecturer_id": "46ef755f-7fcd-4cd4-b4c8-d1f6f566fad9",
      "lecturer_name": "陈伟明",
      "lecturer_email": "report-fixture-68061654-62b8-458f-ab66-399ce798a800@seam1.test",
      "department_id": null,
      "department_code": null,
      "department_name": null,
      "timetable_missing": true,
      "offerings": [
        {
          "coordinator": false,
          "course_code": "BITI2233-4189ea99",
          "offering_id": "adb6f4fc-eee8-4d66-8d50-593465d41bae",
          "course_title": "+Statistik Asas",
          "department_id": "954dc9d1-74b7-4998-afd6-d69d4a690c6d",
          "department_code": "FTMK-4189ea99",
          "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
          "missing_sections": [
            4,
            5,
            6,
            10,
            17,
            18,
            19
          ],
          "needs_fix_sections": [
            2
          ]
        }
      ]
    }
  ],
  "chloeOfferings": [
    {
      "offering_id": "627ad45f-2966-4ff6-9ff4-16d7e50f96aa",
      "course_code": "BITP1113-4189ea99",
      "course_title": "Pemrograman Komputer",
      "department_id": "954dc9d1-74b7-4998-afd6-d69d4a690c6d",
      "department_code": "FTMK-4189ea99",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "coordinator_id": "f4743c30-791a-40e6-8d7c-d19d975cc0d9",
      "coordinator_name": "Aisyah Rahman",
      "coordinator_email": null,
      "status": "verified",
      "counted_sections": 9,
      "uploaded_sections": 9,
      "verified_sections": 9,
      "needs_fix_sections": 0,
      "percent_complete": 100,
      "missing_sections": [],
      "section_statuses": [
        "verified",
        "verified",
        "verified",
        "verified",
        "verified",
        "verified",
        "empty",
        "empty",
        "empty",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "verified",
        "verified",
        "verified"
      ],
      "last_upload_at": "2026-11-24T01:34:34.746454+00:00"
    },
    {
      "offering_id": "498eccf1-a080-49b2-8159-4b4d8c12df54",
      "course_code": "BITS3343-4189ea99",
      "course_title": "Pengaturcaraan \"Java\", Lanjutan",
      "department_id": "46bbfbaf-7425-4bff-b840-90661df59b09",
      "department_code": "JKP-4189ea99",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "coordinator_id": "78aa1136-ee34-4973-bb7f-65c0eeddf32e",
      "coordinator_name": "Chloé Lefèvre",
      "coordinator_email": null,
      "status": "needs_fix",
      "counted_sections": 10,
      "uploaded_sections": 10,
      "verified_sections": 1,
      "needs_fix_sections": 1,
      "percent_complete": 100,
      "missing_sections": [],
      "section_statuses": [
        "verified",
        "pending_review",
        "pending_review",
        "pending_review",
        "pending_review",
        "needs_fix",
        "empty",
        "empty",
        "empty",
        "pending_review",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "pending_review",
        "pending_review",
        "pending_review"
      ],
      "last_upload_at": "2026-11-24T01:34:34.807342+00:00"
    }
  ]
}
