       IDENTIFICATION DIVISION.
       PROGRAM-ID. SMALLSAFE1.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  I               PIC S9(9) COMP VALUE 0.
       01  SUM1             PIC S9(18) COMP VALUE 0.
       01  VALUE-TABLE.
           05  VALUE-ITEM  PIC S9(9) COMP OCCURS 50 TIMES
                            INDEXED BY IDX.

       PROCEDURE DIVISION.

           DISPLAY "cobol code".