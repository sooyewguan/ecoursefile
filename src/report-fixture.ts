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
  "semesterCode": "2861/2862-1",
  "facultySummary": [
    {
      "offerings": 5,
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
      "department_id": "f77d2fc5-01d6-44dd-8f6b-7b354cb2a893",
      "department_code": "FTMK-b34c2a74",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "offerings": 2,
      "counted_sections": 19,
      "uploaded_sections": 12,
      "verified_sections": 9,
      "needs_fix_sections": 1,
      "percent_uploaded": 63.2,
      "percent_verified": 47.4,
      "percent_needs_fix": 5.3
    },
    {
      "department_id": "d4137d2c-81ad-4394-b89d-727378c34940",
      "department_code": "JKP-b34c2a74",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "offerings": 3,
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
      "offering_id": "78cbe8d4-a91c-414b-898a-b23d9fdc286f",
      "course_code": "BITI2233-b34c2a74",
      "course_title": "+Statistik Asas",
      "department_id": "f77d2fc5-01d6-44dd-8f6b-7b354cb2a893",
      "department_code": "FTMK-b34c2a74",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "coordinator_id": "b9a8ae22-6d6e-4ddf-b8f8-42ad33bc4a2e",
      "coordinator_name": "=HYPERLINK(\"https://example.com\",\"Open\")",
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
      "last_upload_at": "2026-11-20T07:24:18.922862+00:00"
    },
    {
      "offering_id": "b75b6090-7572-42c6-9791-2293e4e13f0f",
      "course_code": "BITM3423-b34c2a74",
      "course_title": "Sains Data\nGunaan",
      "department_id": "d4137d2c-81ad-4394-b89d-727378c34940",
      "department_code": "JKP-b34c2a74",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "coordinator_id": "858d08d2-dd93-42c0-bcb7-1403e32c90cb",
      "coordinator_name": "@SUM(1+1)",
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
      "last_upload_at": "2026-11-20T07:24:18.91471+00:00"
    },
    {
      "offering_id": "4e21cf03-d5da-488f-bd54-18648f672144",
      "course_code": "BITP1113-b34c2a74",
      "course_title": "Pemrograman Komputer",
      "department_id": "f77d2fc5-01d6-44dd-8f6b-7b354cb2a893",
      "department_code": "FTMK-b34c2a74",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "coordinator_id": "6c143311-40ad-4192-9b56-0ae27dbcabca",
      "coordinator_name": "Aisyah Rahman",
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
      "last_upload_at": "2026-11-20T07:24:18.890849+00:00"
    },
    {
      "offering_id": "93d13c84-356c-4dcc-968d-b1c33b23973c",
      "course_code": "BITS3343-b34c2a74",
      "course_title": "Pengaturcaraan \"Java\", Lanjutan",
      "department_id": "d4137d2c-81ad-4394-b89d-727378c34940",
      "department_code": "JKP-b34c2a74",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "coordinator_id": "0109bbc9-59cf-4170-b1e2-79d1688e06d4",
      "coordinator_name": "Chloé Lefèvre",
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
      "last_upload_at": "2026-11-20T07:24:18.912405+00:00"
    },
    {
      "offering_id": "4455ed3e-18f5-4e9f-bdb9-cdca7a70c600",
      "course_code": "BITU3973-b34c2a74",
      "course_title": "Projek Sarjana Muda",
      "department_id": "d4137d2c-81ad-4394-b89d-727378c34940",
      "department_code": "JKP-b34c2a74",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "coordinator_id": "9230e73e-1f0e-4f2d-add9-f9b2548347fe",
      "coordinator_name": "-2+3 Dash",
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
      "lecturer_id": "7cac7a8f-fc7a-46e6-a28b-5baa5daac918",
      "lecturer_name": "\tTabbed Name",
      "department_id": null,
      "department_code": null,
      "department_name": null,
      "timetable_missing": true,
      "offerings": [
        {
          "coordinator": false,
          "course_code": "BITU3973-b34c2a74",
          "offering_id": "4455ed3e-18f5-4e9f-bdb9-cdca7a70c600",
          "course_title": "Projek Sarjana Muda",
          "missing_sections": [
            2,
            4,
            5,
            6,
            17,
            18,
            19
          ]
        }
      ]
    },
    {
      "lecturer_id": "f5f999d0-6e3e-461f-b07b-912d4a35271f",
      "lecturer_name": "\rReturned Name",
      "department_id": null,
      "department_code": null,
      "department_name": null,
      "timetable_missing": true,
      "offerings": [
        {
          "coordinator": false,
          "course_code": "BITU3973-b34c2a74",
          "offering_id": "4455ed3e-18f5-4e9f-bdb9-cdca7a70c600",
          "course_title": "Projek Sarjana Muda",
          "missing_sections": [
            2,
            4,
            5,
            6,
            17,
            18,
            19
          ]
        }
      ]
    },
    {
      "lecturer_id": "9230e73e-1f0e-4f2d-add9-f9b2548347fe",
      "lecturer_name": "-2+3 Dash",
      "department_id": "d4137d2c-81ad-4394-b89d-727378c34940",
      "department_code": "JKP-b34c2a74",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "timetable_missing": true,
      "offerings": [
        {
          "coordinator": true,
          "course_code": "BITU3973-b34c2a74",
          "offering_id": "4455ed3e-18f5-4e9f-bdb9-cdca7a70c600",
          "course_title": "Projek Sarjana Muda",
          "missing_sections": [
            2,
            4,
            5,
            6,
            17,
            18,
            19
          ]
        }
      ]
    },
    {
      "lecturer_id": "858d08d2-dd93-42c0-bcb7-1403e32c90cb",
      "lecturer_name": "@SUM(1+1)",
      "department_id": "d4137d2c-81ad-4394-b89d-727378c34940",
      "department_code": "JKP-b34c2a74",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "timetable_missing": false,
      "offerings": [
        {
          "coordinator": true,
          "course_code": "BITM3423-b34c2a74",
          "offering_id": "b75b6090-7572-42c6-9791-2293e4e13f0f",
          "course_title": "Sains Data\nGunaan",
          "missing_sections": []
        }
      ]
    },
    {
      "lecturer_id": "b9a8ae22-6d6e-4ddf-b8f8-42ad33bc4a2e",
      "lecturer_name": "=HYPERLINK(\"https://example.com\",\"Open\")",
      "department_id": "f77d2fc5-01d6-44dd-8f6b-7b354cb2a893",
      "department_code": "FTMK-b34c2a74",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "timetable_missing": false,
      "offerings": [
        {
          "coordinator": true,
          "course_code": "BITI2233-b34c2a74",
          "offering_id": "78cbe8d4-a91c-414b-898a-b23d9fdc286f",
          "course_title": "+Statistik Asas",
          "missing_sections": [
            5,
            6,
            10,
            17,
            18,
            19
          ]
        }
      ]
    },
    {
      "lecturer_id": "6c143311-40ad-4192-9b56-0ae27dbcabca",
      "lecturer_name": "Aisyah Rahman",
      "department_id": "f77d2fc5-01d6-44dd-8f6b-7b354cb2a893",
      "department_code": "FTMK-b34c2a74",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "timetable_missing": false,
      "offerings": [
        {
          "coordinator": true,
          "course_code": "BITP1113-b34c2a74",
          "offering_id": "4e21cf03-d5da-488f-bd54-18648f672144",
          "course_title": "Pemrograman Komputer",
          "missing_sections": []
        }
      ]
    },
    {
      "lecturer_id": "0109bbc9-59cf-4170-b1e2-79d1688e06d4",
      "lecturer_name": "Chloé Lefèvre",
      "department_id": "d4137d2c-81ad-4394-b89d-727378c34940",
      "department_code": "JKP-b34c2a74",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "timetable_missing": false,
      "offerings": [
        {
          "coordinator": false,
          "course_code": "BITP1113-b34c2a74",
          "offering_id": "4e21cf03-d5da-488f-bd54-18648f672144",
          "course_title": "Pemrograman Komputer",
          "missing_sections": []
        },
        {
          "coordinator": true,
          "course_code": "BITS3343-b34c2a74",
          "offering_id": "93d13c84-356c-4dcc-968d-b1c33b23973c",
          "course_title": "Pengaturcaraan \"Java\", Lanjutan",
          "missing_sections": []
        }
      ]
    },
    {
      "lecturer_id": "e02d588f-39b0-4db5-bad2-7a6289305d45",
      "lecturer_name": "陈伟明",
      "department_id": null,
      "department_code": null,
      "department_name": null,
      "timetable_missing": true,
      "offerings": [
        {
          "coordinator": false,
          "course_code": "BITI2233-b34c2a74",
          "offering_id": "78cbe8d4-a91c-414b-898a-b23d9fdc286f",
          "course_title": "+Statistik Asas",
          "missing_sections": [
            4,
            5,
            6,
            10,
            17,
            18,
            19
          ]
        }
      ]
    }
  ],
  "chloeOfferings": [
    {
      "offering_id": "4e21cf03-d5da-488f-bd54-18648f672144",
      "course_code": "BITP1113-b34c2a74",
      "course_title": "Pemrograman Komputer",
      "department_id": "f77d2fc5-01d6-44dd-8f6b-7b354cb2a893",
      "department_code": "FTMK-b34c2a74",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "coordinator_id": "6c143311-40ad-4192-9b56-0ae27dbcabca",
      "coordinator_name": "Aisyah Rahman",
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
      "last_upload_at": "2026-11-20T07:24:18.890849+00:00"
    },
    {
      "offering_id": "93d13c84-356c-4dcc-968d-b1c33b23973c",
      "course_code": "BITS3343-b34c2a74",
      "course_title": "Pengaturcaraan \"Java\", Lanjutan",
      "department_id": "d4137d2c-81ad-4394-b89d-727378c34940",
      "department_code": "JKP-b34c2a74",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "coordinator_id": "0109bbc9-59cf-4170-b1e2-79d1688e06d4",
      "coordinator_name": "Chloé Lefèvre",
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
      "last_upload_at": "2026-11-20T07:24:18.912405+00:00"
    }
  ]
}
