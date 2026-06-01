       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOOP22.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-I         
       01  WS-J         PIC 9(6)   VALUE 0.
       01  WS-K         PIC 9(6)   VALUE 0.
       01  WS-L         PIC 9(6)   VALUE 0.
       01  WS-TOTAL     PIC 9(18)  VALUE 0.
       01  WS-TEMP      PIC 9(18)  VALUE 0.
       01  SUM     PIC 9(18)  VALUE 0.
       01  WS-FLAG      PIC X      VALUE 'N'.

       PROCEDURE DIVISION.

       MAIN-LOOP.
           PERFORM VARYING I FROM 1 BY 1 UNTIL I > 200
              PERFORM VARYING J FROM 1 BY 1 UNTIL J > 150
                 PERFORM VARYING K FROM 1 BY 1 UNTIL K > 100
                    PERFORM VARYING L FROM 1 BY 1 UNTIL L > 50
                       PERFORM VARYING M FROM 1 BY 1 UNTIL M > 25
                          PERFORM VARYING N FROM 1 BY 1 UNTIL N > 10
                             PERFORM VARYING O FROM 1 BY 1 UNTIL O > 5
                                 COMPUTE TEMP = I * J + K * L + M * N 
                                   ADD TEMP TO SUM
                             END-PERFORM
                          END-PERFORM
                       END-PERFORM
                    END-PERFORM
                 END-PERFORM
              END-PERFORM
           END-PERFORM
           STOP RUN.

       BUSINESS-LOOP.
           PERFORM VARYING WS-J FROM 1 BY 1
               UNTIL WS-J > 600
               PERFORM DECISION-LOGIC
           END-PERFORM.

       DECISION-LOGIC.
           IF WS-J > 30000
               MOVE 'Y' TO WS-FLAG
           ELSE
               MOVE 'N' TO WS-FLAG
           END-IF
           PERFORM CALCULATION-LOOP.

       CALCULATION-LOOP.
           PERFORM VARYING WS-K FROM 1 BY 1
               UNTIL WS-K > 20
               PERFORM VARYING WS-L FROM 1 BY 1
                   UNTIL WS-L > 10
                   PERFORM VARYING WS-J FROM 1 BY 1
                       UNTIL WS-J > 600
                       IF WS-FLAG = 'Y'
                           COMPUTE WS-TEMP =
                               (WS-I * WS-J) + WS-K + WS-L
                       ELSE
                           COMPUTE WS-TEMP =
                               (WS-I + WS-J + WS-L) * WS-K
                       END-IF
                       ADD WS-TEMP TO WS-TOTAL
                   END-PERFORM
               END-PERFORM
           END-PERFORM.

       