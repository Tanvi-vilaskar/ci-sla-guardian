       IDENTIFICATION DIVISION.
       PROGRAM-ID. PROG4.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 ARR.
          05 A OCCURS 1000 TIMES PIC 9(5) VALUE 0.
       01 I PIC 9(5) VALUE 0.
       01 J PIC 9(5) VALUE 0.
       01 K PIC 9(5) VALUE 0.
       01 TEMP PIC 9(5) VALUE 0.
       01 DUMMY PIC 9(9) VALUE 0.

       PROCEDURE DIVISION.

      * Repeat entire process multiple times
           PERFORM VARYING K FROM 1 BY 1 UNTIL K > 50

      * Fill array in reverse order
               PERFORM VARYING I FROM 1 BY 1 UNTIL I > 1000
                   COMPUTE A(I) = 1001 - I
               END-PERFORM

      * Bubble Sort (CPU heavy)
               PERFORM VARYING I FROM 1 BY 1 UNTIL I > 999
                   PERFORM VARYING J FROM 1 BY 1 UNTIL J >= 1000

      * Extra CPU work (dummy calculations)
                       PERFORM VARYING DUMMY FROM 1 BY 1 UNTIL DUMMY > 500
                           COMPUTE TEMP = (DUMMY * DUMMY) / 3
                       END-PERFORM

                       IF J < 1000 AND A(J) > A(J + 1)
                           MOVE A(J) TO TEMP
                           MOVE A(J + 1) TO A(J)
                           MOVE TEMP TO A(J + 1)
                       END-IF

                   END-PERFORM
               END-PERFORM

           END-PERFORM

           DISPLAY "SORT DONE"
           STOP RUN.